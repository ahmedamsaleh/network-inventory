/**
 * Streaming exports of one or more datasets as CSV, XLSX or (several CSV
 * files) ZIP, filtered with the same criteria as the pagination endpoints.
 *
 *   exportToResponse(response, { datasets, format, query, markApiFlag })
 *
 * datasets: names from services/datasets.js plus the virtual datasets
 * "enrichment" (legacy B_TED rows) and "secondpop_check".
 * format:   'csv'  - one dataset: a CSV file; several: a ZIP of CSV files
 *           'xlsx' - one workbook, one worksheet per dataset
 */
const { stringify } = require('csv-stringify');
const ExcelJS = require('exceljs');
const archiver = require('archiver');
const datasets = require('./datasets');
const filters = require('./filters');
const enrichmentRows = require('./enrichmentRows');
const linkChecks = require('./linkChecks');
const Interface = require('../models/interface');

const VIRTUAL = {
  enrichment: {
    label: 'Enrichment (B_TED)',
    filterSpec: datasets.devices, // criteria apply to the devices
    columns: enrichmentRows.COLUMNS,
    rows: (query) => enrichmentRows.rows(filters.buildFilter(datasets.devices, query)),
  },
  secondpop_check: {
    label: 'secondPOP check (interfaces vs links)',
    filterSpec: datasets.interfaces,
    columns: linkChecks.COLUMNS,
    rows: (query) => linkChecks.rows(filters.buildFilter(datasets.interfaces, query)),
  },
};

const LABELS = {
  devices: 'Devices',
  interfaces: 'Interfaces',
  pops: 'POPs',
  cabinets: 'Cabinets',
  devicemodels: 'Device models',
  btmsaninfos: 'BT MSAN info',
  links: 'Links',
  decommissionedDevices: 'Decommissioned devices',
  auditlogs: 'Audit log',
  sectors: 'Sectors',
  counties: 'Counties',
  enrichments: 'Enrichment table (B_TED rows as stored)',
};

function available() {
  return [
    ...Object.keys(datasets.all).map((name) => ({ name, label: LABELS[name] || name })),
    ...Object.entries(VIRTUAL).map(([name, spec]) => ({ name, label: spec.label })),
  ];
}

function isKnown(name) {
  return Boolean(datasets.all[name] || VIRTUAL[name]);
}

/** columns ([key, header]) and an async row iterator for a dataset + query */
function datasetStream(name, query) {
  if (VIRTUAL[name]) {
    return { columns: VIRTUAL[name].columns, rows: VIRTUAL[name].rows(query) };
  }
  const spec = datasets.all[name];
  const filter = filters.buildFilter(spec, query);
  const sortField = Object.prototype.hasOwnProperty.call(spec.sortable, query.sort)
    ? query.sort
    : spec.defaultSort;
  const direction = String(query.order || '').toLowerCase() === 'desc' ? -1 : 1;
  const sort = { [spec.sortable[sortField]]: direction, _id: direction };
  const cursor = spec.Model.find(filter, spec.projection).sort(sort).lean().cursor();
  async function* rows() {
    for await (const doc of cursor) yield spec.mapRow(doc);
  }
  return { columns: datasets.columnsOf(spec), rows: rows() };
}

function cellValue(value) {
  if (value === undefined || value === null) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

/** marks exported interfaces as sent to the external API (apiFlag = true) */
async function markInterfaces(ids) {
  if (ids.length === 0) return 0;
  const result = await Interface.updateMany({ _id: { $in: ids } }, { $set: { apiFlag: true } });
  return result.modifiedCount || 0;
}

/** pipes one dataset as CSV into a writable (resolves when all rows are written) */
async function writeCsv(writable, name, query, options = {}) {
  const { columns, rows } = datasetStream(name, query);
  const stringifier = stringify({
    header: true,
    columns: columns.map(([key, header]) => ({ key, header })),
  });
  stringifier.pipe(writable, { end: options.end !== false });
  const finished = new Promise((resolve, reject) => {
    stringifier.on('error', reject);
    writable.on('error', reject);
    if (options.end === false) stringifier.on('end', resolve);
    else writable.on('finish', resolve);
  });
  const flagged = [];
  for await (const row of rows) {
    const out = {};
    for (const [key] of columns) out[key] = cellValue(row[key]);
    if (!stringifier.write(out)) await new Promise((resolve) => stringifier.once('drain', resolve));
    if (options.markApiFlag && name === 'interfaces' && row._id) flagged.push(row._id);
  }
  stringifier.end();
  await finished;
  if (flagged.length) await markInterfaces(flagged);
}

function fileStamp() {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

/**
 * Streams the export into an express response.
 * @returns {Promise<{files: string[], format: string}>}
 */
async function exportToResponse(
  response,
  { datasets: names, format = 'csv', query = {}, markApiFlag = false }
) {
  const selected = (Array.isArray(names) ? names : String(names || '').split(','))
    .map((n) => String(n).trim())
    .filter((n) => n && isKnown(n));
  if (selected.length === 0) throw new Error('no dataset selected');
  const stamp = fileStamp();

  if (format === 'xlsx') {
    const filename = (selected.length === 1 ? selected[0] : 'inventory') + '-' + stamp + '.xlsx';
    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    response.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream: response,
      useStyles: false,
      useSharedStrings: false,
    });
    for (const name of selected) {
      const { columns, rows } = datasetStream(name, query);
      const sheet = workbook.addWorksheet(name.slice(0, 31));
      sheet.addRow(columns.map(([, header]) => header)).commit();
      const flagged = [];
      for await (const row of rows) {
        sheet.addRow(columns.map(([key]) => cellValue(row[key]))).commit();
        if (markApiFlag && name === 'interfaces' && row._id) flagged.push(row._id);
      }
      sheet.commit();
      if (flagged.length) await markInterfaces(flagged);
    }
    await workbook.commit();
    return { files: [filename], format };
  }

  if (selected.length === 1) {
    const filename = selected[0] + '-' + stamp + '.csv';
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    await writeCsv(response, selected[0], query, { markApiFlag });
    return { files: [filename], format };
  }

  // several datasets as CSV: one file each, delivered as a ZIP archive
  const filename = 'inventory-' + stamp + '.zip';
  response.setHeader('Content-Type', 'application/zip');
  response.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
  const archive = archiver('zip', { zlib: { level: 6 } });
  const done = new Promise((resolve, reject) => {
    archive.on('error', reject);
    response.on('finish', resolve);
    response.on('error', reject);
  });
  archive.pipe(response);
  const files = [];
  for (const name of selected) {
    const entryName = name + '.csv';
    const { PassThrough } = require('stream');
    const entry = new PassThrough();
    archive.append(entry, { name: entryName });
    await writeCsv(entry, name, query, { markApiFlag });
    files.push(entryName);
  }
  await archive.finalize();
  await done;
  return { files, format: 'zip' };
}

module.exports = { exportToResponse, datasetStream, available, isKnown, VIRTUAL, markInterfaces };
