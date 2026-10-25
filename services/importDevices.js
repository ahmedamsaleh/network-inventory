/**
 * Bulk device import from CSV / XLSX.
 *
 * Rows are streamed (middleware/import_enrichment.readRows) and written in
 * batches with bulkWrite (upsert by hostname), so tens of thousands of rows
 * never sit in memory at once. Every row problem is reported with its row
 * number; a failing row never stops the import.
 *
 * Required columns: ipaddress, hostname, community (header names are matched
 * case-insensitively, a few aliases are accepted). Optional: type, model,
 * vendor, pop, description, cabinet, cty, district, popType, popLongName,
 * btMSANCode, btMngIP, btSector, btDistrict, defaultCollector. Everything
 * else is filled in by the sync.
 */
const net = require('net');
const logger = require('../middleware/logger');
const Device = require('../models/device');
const { readRows } = require('../middleware/import_enrichment');

const BATCH_SIZE = Number(process.env.IMPORT_BATCH_SIZE || 1000);
const MAX_REPORTED_ERRORS = 1000;

const COLUMNS = {
  ipaddress: ['ipaddress', 'ip', 'ip address', 'ipaddr', 'management ip', 'mngip'],
  hostname: ['hostname', 'host', 'host name', 'device', 'device name', 'name'],
  community: [
    'community',
    'community string',
    'communitystring',
    'snmp community',
    'snmpcommunity',
  ],
  type: ['type', 'device type', 'devicetype'],
  model: ['model'],
  vendor: ['vendor'],
  pop: ['pop', 'pop short name', 'popshortname'],
  description: ['description'],
  cabinet: ['cabinet'],
  cty: ['cty', 'county'],
  district: ['district'],
  popType: ['poptype', 'pop type'],
  popLongName: ['poplongname', 'pop long name'],
  btMSANCode: ['btmsancode', 'msan code', 'msancode'],
  btMngIP: ['btmngip', 'bt management ip'],
  btSector: ['btsector', 'bt sector'],
  btDistrict: ['btdistrict', 'bt district'],
  defaultCollector: ['defaultcollector', 'default collector', 'collector'],
};
const REQUIRED = ['ipaddress', 'hostname', 'community'];
const NUMERIC = new Set(['defaultCollector']);

/** header text -> canonical column name (null when the header is unknown) */
function canonicalColumn(header) {
  const key = String(header || '')
    .trim()
    .toLowerCase();
  for (const [name, aliases] of Object.entries(COLUMNS)) {
    if (name.toLowerCase() === key || aliases.includes(key)) return name;
  }
  return null;
}

/** a row's raw values -> { fields, errors } after validation */
function normalizeRow(values) {
  const fields = {};
  const errors = [];
  for (const [header, raw] of Object.entries(values)) {
    const column = canonicalColumn(header);
    if (!column) continue;
    const text = String(raw === undefined || raw === null ? '' : raw).trim();
    if (text === '') continue;
    if (NUMERIC.has(column)) {
      const number = Number(text);
      if (!Number.isFinite(number)) errors.push(column + ' is not a number');
      else fields[column] = number;
    } else {
      fields[column] = text;
    }
  }
  for (const column of REQUIRED) {
    if (!fields[column]) errors.push(column + ' is required');
  }
  if (fields.ipaddress && !net.isIPv4(fields.ipaddress)) errors.push('IP address is not valid');
  if (fields.hostname && fields.hostname.length < 5) errors.push('hostname is too short');
  return { fields, errors };
}

function newReport(file) {
  return {
    file: String(file),
    status: 'running',
    startedAt: new Date(),
    finishedAt: null,
    durationMs: 0,
    total: 0,
    inserted: 0,
    updated: 0,
    failed: 0,
    errorCount: 0,
    errors: [],
    unknownHeaders: [],
    missingHeaders: [],
  };
}

function reportError(report, rowNumber, hostname, ipaddress, message) {
  report.failed += 1;
  report.errorCount += 1;
  if (report.errors.length < MAX_REPORTED_ERRORS) {
    report.errors.push({
      row: rowNumber,
      hostname: hostname || '',
      ipaddress: ipaddress || '',
      message,
    });
  }
}

/** writes one batch of validated rows; reports duplicates / write errors */
async function flushBatch(batch, report, author, now, decommissioned) {
  if (batch.length === 0) return;
  // duplicates inside the batch (later rows lose)
  const seenHost = new Map();
  const seenIp = new Map();
  const rows = [];
  for (const item of batch) {
    const hostKey = item.fields.hostname.toLowerCase();
    if (seenHost.has(hostKey)) {
      reportError(
        report,
        item.rowNumber,
        item.fields.hostname,
        item.fields.ipaddress,
        'duplicate hostname in file (row ' + seenHost.get(hostKey) + ')'
      );
      continue;
    }
    if (seenIp.has(item.fields.ipaddress)) {
      reportError(
        report,
        item.rowNumber,
        item.fields.hostname,
        item.fields.ipaddress,
        'duplicate IP address in file (row ' + seenIp.get(item.fields.ipaddress) + ')'
      );
      continue;
    }
    seenHost.set(hostKey, item.rowNumber);
    seenIp.set(item.fields.ipaddress, item.rowNumber);
    rows.push(item);
  }
  // an IP already used by another hostname in the database
  const existing = await Device.find(
    { ipaddress: { $in: rows.map((item) => item.fields.ipaddress) } },
    { hostname: 1, ipaddress: 1 }
  ).lean();
  const ipOwner = new Map(existing.map((device) => [device.ipaddress, device.hostname]));
  const operations = [];
  const byIndex = [];
  for (const item of rows) {
    // a hostname that belongs to a decommissioned device (restore it first)
    if (decommissioned.has(item.fields.hostname.toLowerCase())) {
      reportError(
        report,
        item.rowNumber,
        item.fields.hostname,
        item.fields.ipaddress,
        'hostname belongs to a decommissioned device (restore it first)'
      );
      continue;
    }
    const owner = ipOwner.get(item.fields.ipaddress);
    if (owner && owner.toLowerCase() !== item.fields.hostname.toLowerCase()) {
      reportError(
        report,
        item.rowNumber,
        item.fields.hostname,
        item.fields.ipaddress,
        'IP address already used by ' + owner
      );
      continue;
    }
    const set = { ...item.fields, communityString: item.fields.community, updatedAt: now };
    operations.push({
      updateOne: {
        filter: { hostname: item.fields.hostname },
        update: {
          $set: set,
          $setOnInsert: { createdAt: now, discovered: false, interfaces: [], author: author || {} },
        },
        upsert: true,
      },
    });
    byIndex.push(item);
  }
  if (operations.length === 0) return;
  let result;
  try {
    result = await Device.bulkWrite(operations, { ordered: false });
  } catch (error) {
    // partial failure: mongoose throws a BulkWriteError carrying the result
    result = error.result || error.writeErrors ? error : null;
    if (!result) {
      for (const item of byIndex)
        reportError(
          report,
          item.rowNumber,
          item.fields.hostname,
          item.fields.ipaddress,
          error.message
        );
      return;
    }
  }
  const writeErrors = (
    result.writeErrors ||
    (result.result && result.result.writeErrors) ||
    []
  ).map((e) =>
    typeof e.index === 'number'
      ? e
      : { index: e.err && e.err.index, errmsg: e.errmsg || (e.err && e.err.errmsg) }
  );
  const failedIndexes = new Set();
  for (const writeError of writeErrors) {
    const item = byIndex[writeError.index];
    if (item) {
      failedIndexes.add(writeError.index);
      reportError(
        report,
        item.rowNumber,
        item.fields.hostname,
        item.fields.ipaddress,
        writeError.errmsg || 'write error'
      );
    }
  }
  const upserted =
    result.upsertedCount !== undefined
      ? result.upsertedCount
      : result.result
        ? result.result.nUpserted
        : 0;
  const matched =
    result.matchedCount !== undefined
      ? result.matchedCount
      : result.result
        ? result.result.nMatched
        : 0;
  report.inserted += upserted;
  report.updated += matched;
}

/**
 * Imports a CSV/XLSX file of devices. Resolves with the report (never rejects).
 * @param {string} file
 * @param {object} [options] { author, sheet, batchSize, onProgress }
 */
async function importDevices(file, options = {}) {
  const report = newReport(file);
  const batchSize = Math.max(1, Number(options.batchSize || BATCH_SIZE));
  const now = new Date();
  let batch = [];
  let headersChecked = false;
  try {
    // hostnames of decommissioned devices: rows for them are refused (looked up once)
    const decommissioned = new Set(
      (await Device.find({ decommissioned: true }, { hostname: 1 }).lean()).map((device) =>
        String(device.hostname).toLowerCase()
      )
    );
    for await (const { rowNumber, values } of readRows(file, { sheet: options.sheet })) {
      if (!headersChecked) {
        headersChecked = true;
        const headers = Object.keys(values);
        const canonical = headers.map(canonicalColumn);
        report.unknownHeaders = headers.filter((h, i) => !canonical[i]);
        report.missingHeaders = REQUIRED.filter((column) => !canonical.includes(column));
        if (report.missingHeaders.length) {
          throw new Error('missing required column(s): ' + report.missingHeaders.join(', '));
        }
      }
      report.total += 1;
      const { fields, errors } = normalizeRow(values);
      if (errors.length) {
        reportError(report, rowNumber, fields.hostname, fields.ipaddress, errors.join('; '));
        continue;
      }
      batch.push({ rowNumber, fields });
      if (batch.length >= batchSize) {
        await flushBatch(batch, report, options.author, now, decommissioned);
        batch = [];
        if (options.onProgress) options.onProgress(report);
      }
    }
    await flushBatch(batch, report, options.author, now, decommissioned);
    report.status = 'done';
  } catch (error) {
    report.status = 'failed';
    report.error = error.message;
    logger.error('device import ' + file + ' failed: ' + error.message);
  }
  report.finishedAt = new Date();
  report.durationMs = report.finishedAt - report.startedAt;
  logger.info(
    'device import ' +
      file +
      ': ' +
      report.inserted +
      ' inserted, ' +
      report.updated +
      ' updated, ' +
      report.failed +
      ' failed of ' +
      report.total
  );
  return report;
}

/* ------------------------------------------------------------ background */
let currentImport = null;
let lastImport = null;

function start(file, options = {}) {
  if (currentImport) return currentImport.promise;
  const report = newReport(file);
  const promise = importDevices(file, {
    ...options,
    onProgress: (partial) => Object.assign(report, partial),
  }).then((finished) => {
    Object.assign(report, finished);
    lastImport = report;
    currentImport = null;
    return report;
  });
  currentImport = { report, promise };
  return promise;
}

function isRunning() {
  return currentImport !== null;
}

function status() {
  return { running: currentImport ? currentImport.report : null, lastImport };
}

module.exports = {
  importDevices,
  start,
  isRunning,
  status,
  normalizeRow,
  canonicalColumn,
  COLUMNS,
  REQUIRED,
  BATCH_SIZE,
};
