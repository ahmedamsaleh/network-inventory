/**
 * Import helpers.
 *
 *   readRows(file, options)   async generator over the rows of a CSV or XLSX
 *                             file (streamed - never loads the file in memory)
 *   importPops(file)          the "POPs" sheet (CSV or XLSX)
 *   createDocRecurse(file)    the legacy enrichment CSV (B_TED_* columns)
 *   uploadPath(name)          where uploads are stored
 *
 * The bulk device import lives in services/importDevices.js and uses
 * readRows() as well.
 */
const fs = require('fs');
const { parse: parseCsv } = require('csv-parse');
const ExcelJS = require('exceljs');
const path = require('path');
const POP = require('../models/pop');
const deviceModels = require('../services/deviceModels');
const Enrichment = require('../models/enrichment');
const Device = require('../models/device');
const enrichmentData = require('../lookUps/enrich');
const logger = require('../middleware/logger'); //logging component
const S = require('string');
let lineList = '';
const deviceList = [];
const deviceData = {
  B_TED_Elt_Device: 12,
  B_TED_Elt_IP: 13,
  B_TED_Elt_Model: 14,
  B_TED_Elt_POP_Cty: 15,
  B_TED_Elt_POP_Name: 16,
  B_TED_Elt_Type: 17,
  B_TED_Elt_Vendor: 18,
  CommunityString: 64,
};

// Go through the CSV file adding one enrichment document per line (and a
// device for every hostname not seen before); never rejects.
async function createDocRecurse(filename) {
  let contents;
  try {
    contents = await fs.promises.readFile(S(filename).s, 'utf8');
  } catch (err) {
    logger.error(err);
    return;
  }
  logger.info('reading enrichment file ' + S(filename).s);
  lineList = contents.toString().split('\n');
  for (let key = 1; key < lineList.length; key++) {
    //skip first header line
    const line = lineList[key];
    const doc = new Enrichment();
    const device = new Device();
    line.split(',').forEach(function (entry, i) {
      entry = entry.replace(/\r$/, '');
      if (entry !== '' && enrichmentData.extendedEnrichmentFields[i]) {
        doc[enrichmentData.extendedEnrichmentFields[i]] = entry;
      }
      if (i == deviceData.B_TED_Elt_Device) {
        //
        device.hostname = entry;
      } else if (i == deviceData.B_TED_Elt_IP) {
        //
        device.ipaddress = entry;
      } else if (i == deviceData.B_TED_Elt_Model) {
        device.model = entry;
      } else if (i == deviceData.B_TED_Elt_POP_Cty) {
        device.county.name = entry;
      } else if (i == deviceData.B_TED_Elt_POP_Name) {
        device.popName.name = entry;
      } else if (i == deviceData.B_TED_Elt_Type) {
        device.type = entry;
      } else if (i == deviceData.B_TED_Elt_Vendor) {
        device.vendor = entry;
      } else if (i == deviceData.CommunityString) {
        device.community = S(entry).s;
        device.communityString = device.community;
      }
    });
    try {
      await doc.save();
    } catch (error) {
      logger.error(error);
    }
    if (!deviceList.includes(device.hostname) && device.hostname) {
      logger.info('searching for device in enrichment mode');
      try {
        const foundDevice = await Device.findOne({ hostname: device.hostname });
        if (foundDevice) {
          logger.info('enriched device already in database');
        } else {
          await deviceModels.applyDeviceModel(device); // vendor/type from the model catalogue
          await device.save();
        }
      } catch (error) {
        logger.error(error);
      }
    }
    // if(!deviceList.includes(device.hostname) && device.hostname) device.save();
    deviceList.push(device.hostname);
  }
}

module.exports.createDocRecurse = createDocRecurse;

/** directory the uploaded CSV files are stored in (import/ next to the app) */
function uploadPath(filename) {
  const dir = path.join(__dirname, '..', 'import');
  return path.join(dir, path.basename(String(filename || 'upload.csv')));
}

/** splits one CSV line on commas, trims the cells and strips surrounding quotes */
function splitCsvLine(line) {
  return String(line)
    .replace(/\r$/, '')
    .split(',')
    .map((cell) =>
      cell
        .trim()
        .replace(/^"(.*)"$/, '$1')
        .trim()
    );
}

/**
 * Imports the "POPs" sheet (CSV). Column layout:
 *   1 shortName (device hostnames start with it, e.g. ONGAR)
 *   2 cty       (county acronym)
 *   3 district  (default Unknown)
 *   4 sector    (default Unknown)
 *   5 popType   (default Unknown)
 *   6 popLongName (default Unknown)
 * pop_cty is computed as shortName + "_" + cty. A header row is skipped when
 * its first cell is "shortName". POPs are upserted by shortName.
 * Never rejects; resolves with { total, created, updated, skipped, errors }.
 */
async function importPops(filename, options = {}) {
  const summary = {
    file: String(filename),
    total: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };
  let rows;
  try {
    rows = readRows(filename, { headers: false, sheet: options.sheet || 'POPs' });
    // an XLSX without a "POPs" sheet falls back to its first sheet
    if (isXlsx(filename)) {
      const probe = readRows(filename, { headers: false, sheet: options.sheet || 'POPs' });
      const first = await probe.next();
      if (first.done) rows = readRows(filename, { headers: false });
      else
        rows = (async function* () {
          yield first.value;
          yield* probe;
        })();
    }
    let isFirst = true;
    for await (const { rowNumber, cells } of rows) {
      if (isFirst && cells[0].toLowerCase() === 'shortname') {
        isFirst = false;
        continue; // header
      }
      isFirst = false;
      summary.total += 1;
      const [shortName, cty, district, sector, popType, popLongName] = cells;
      if (!shortName) {
        summary.skipped += 1;
        summary.errors.push('line ' + rowNumber + ': empty shortName');
        continue;
      }
      const values = POP.normalizeInput({
        shortName,
        cty: cty || '',
        district: district || '',
        sector: sector || '',
        popType: popType || '',
        popLongName: popLongName || '',
      });
      try {
        const existing = await POP.findOne({
          shortName: new RegExp('^' + escapeRegExp(values.shortName) + '$', 'i'),
        });
        if (existing) {
          delete values.shortName; // matched case-insensitively: keep the stored spelling
          existing.set(values);
          await existing.save();
          summary.updated += 1;
        } else {
          await POP.create({
            name: values.popLongName !== POP.UNKNOWN ? values.popLongName : values.shortName,
            ...values,
            author: options.author,
          });
          summary.created += 1;
        }
      } catch (error) {
        summary.skipped += 1;
        summary.errors.push('line ' + rowNumber + ' (' + shortName + '): ' + error.message);
      }
    }
  } catch (error) {
    summary.errors.push('cannot read ' + filename + ': ' + error.message);
    return summary;
  }
  logger.info(
    'POP import ' +
      summary.file +
      ': ' +
      summary.created +
      ' created, ' +
      summary.updated +
      ' updated, ' +
      summary.skipped +
      ' skipped'
  );
  return summary;
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports.importPops = importPops;
module.exports.uploadPath = uploadPath;
module.exports.splitCsvLine = splitCsvLine;

/** text of an XLSX cell value (rich text, formulas, hyperlinks, dates, numbers) */
function cellText(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text).join('');
    if (value.result !== undefined) return cellText(value.result);
    if (value.text !== undefined) return cellText(value.text);
    if (value.hyperlink !== undefined) return cellText(value.text || value.hyperlink);
    return '';
  }
  return String(value);
}

function isXlsx(file) {
  return /\.xlsx$/i.test(String(file));
}

/**
 * Streams the rows of a CSV or XLSX file.
 *   options.sheet    XLSX worksheet name (default: the first sheet)
 *   options.headers  true (default): the first non-empty row is the header and
 *                    rows are yielded as { rowNumber, values: {header: text} };
 *                    false: rows are yielded as { rowNumber, cells: [text] }
 * Header names are trimmed; cell values are trimmed strings.
 */
async function* readRows(file, options = {}) {
  const withHeaders = options.headers !== false;
  let headers = null;
  const emit = (rowNumber, cells) => {
    const trimmed = cells.map((cell) => cellText(cell).trim());
    if (trimmed.every((cell) => cell === '')) return null;
    if (!withHeaders) return { rowNumber, cells: trimmed };
    if (!headers) {
      headers = trimmed.map((h) => h.trim());
      return null;
    }
    const values = {};
    headers.forEach((header, index) => {
      if (header !== '') values[header] = trimmed[index] !== undefined ? trimmed[index] : '';
    });
    return { rowNumber, values };
  };

  if (isXlsx(file)) {
    const workbook = new ExcelJS.stream.xlsx.WorkbookReader(String(file), {
      worksheets: 'emit',
      sharedStrings: 'cache',
      hyperlinks: 'ignore',
      styles: 'ignore',
      entries: 'emit',
    });
    let sheetFound = false;
    let rowsRead = false;
    try {
      for await (const worksheet of workbook) {
        if (
          sheetFound ||
          (options.sheet &&
            String(worksheet.name).toLowerCase() !== String(options.sheet).toLowerCase())
        ) {
          continue;
        }
        sheetFound = true;
        for await (const row of worksheet) {
          rowsRead = true;
          const cells = Array.isArray(row.values) ? row.values.slice(1) : [];
          const out = emit(row.number, cells);
          if (out) yield out;
        }
      }
    } catch (error) {
      if (
        rowsRead ||
        !(error instanceof TypeError) ||
        error.message !== "Cannot read properties of undefined (reading 'sheets')"
      ) {
        throw error;
      }
      // ExcelJS 4.4 can encounter worksheet entries before workbook metadata.
      yield* readXlsxFallback(file, options, emit);
    }
    return;
  }

  const parser = fs.createReadStream(String(file)).pipe(
    parseCsv({
      bom: true,
      relax_column_count: true,
      relax_quotes: true,
      skip_empty_lines: true,
      trim: false,
    })
  );
  let rowNumber = 0;
  for await (const record of parser) {
    rowNumber += 1;
    const out = emit(rowNumber, record);
    if (out) yield out;
  }
}

async function* readXlsxFallback(file, options, emit) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(String(file));
  const sheet = options.sheet
    ? workbook.worksheets.find(
        (worksheet) => worksheet.name.toLowerCase() === String(options.sheet).toLowerCase()
      )
    : workbook.worksheets[0];
  if (!sheet) return;
  for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const cells = Array.isArray(row.values) ? row.values.slice(1) : [];
    const out = emit(row.number, cells);
    if (out) yield out;
  }
}

module.exports.readRows = readRows;
module.exports.cellText = cellText;
