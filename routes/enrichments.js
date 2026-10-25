/**
 * Enrichment data: imports, exports, consistency checks and the external API.
 *
 *   GET  /enrichments                  enrichment documents (legacy table)
 *   GET  /enrichments/new              legacy enrichment CSV upload form
 *   POST /enrichments                  legacy enrichment CSV import (B_TED_* columns)
 *   GET  /enrichments/import           bulk device import page (CSV / XLSX) + last report
 *   POST /enrichments/import/devices   upload -> background streamed import
 *   GET  /enrichments/import/status    JSON progress / last report
 *   GET  /enrichments/export           export form (datasets, format, criteria)
 *   GET  /enrichments/export/download  streamed CSV / XLSX / ZIP export
 *   GET  /enrichments/check/secondpop  secondPOP vs Link collection (JSON, csv, xlsx)
 *   GET  /enrichments/api/:dataset     external API: filtered JSON rows (session or x-api-key)
 *   POST /enrichments/api/interfaces/apiflag  mark interfaces as handed to the external API
 */
const express = require('express');
const audit = require('../services/audit');
const router = express.Router({ mergeParams: true });
const Enrichment = require('../models/enrichment');
const Interface = require('../models/interface');
const middleware = require('../middleware');
const importEnrichment = require('../middleware/import_enrichment');
const importDevices = require('../services/importDevices');
const exporter = require('../services/exporter');
const datasets = require('../services/datasets');
const filters = require('../services/filters');
const pagination = require('../services/pagination');
const linkChecks = require('../services/linkChecks');
const logger = require('../middleware/logger');
const config = require('../config');

const appendMode = true;

/** session login or a valid x-api-key header (API_KEY) */
function apiOrSession(request, response, next) {
  const key = request.get('x-api-key') || request.query.api_key;
  if (config.apiKey && key && key === config.apiKey) return next();
  if (request.isAuthenticated()) return next();
  if (key || request.accepts(['html', 'json']) === 'json') {
    return response.status(401).json({ error: 'unauthorized' });
  }
  return middleware.isLoggedIn(request, response, next);
}

// bootstrap-table server-side pagination of the enrichment table
router.get('/pagination', middleware.isLoggedIn, async function (request, response) {
  response.json(await pagination.paginatedResponse(request.query, datasets.enrichments));
});
//INDEX - the enrichment table is loaded from /enrichments/pagination
router.get('/', middleware.isLoggedIn, async function (request, response) {
  response.render('enrichments/index', { total: await Enrichment.countDocuments({}) });
});

/* ------------------------------------------------------------ exports */

router.get('/export', middleware.isLoggedIn, function (request, response) {
  response.render('enrichments/export', {
    datasets: exporter.available(),
    criteria: {
      devices: Object.keys(datasets.devices.filterable),
      interfaces: Object.keys(datasets.interfaces.filterable),
    },
  });
});

router.get('/export/download', middleware.isLoggedIn, async function (request, response, next) {
  const selected = [].concat(request.query.datasets || request.query.dataset || []).join(',');
  const format = String(request.query.format || 'csv').toLowerCase() === 'xlsx' ? 'xlsx' : 'csv';
  const markApiFlag = ['1', 'true', 'yes', 'on'].includes(
    String(request.query.markApiFlag || '').toLowerCase()
  );
  try {
    await exporter.exportToResponse(response, {
      datasets: selected,
      format,
      query: request.query,
      markApiFlag,
    });
  } catch (error) {
    if (response.headersSent) return next(error);
    request.flash('error', 'Export failed: ' + error.message);
    response.redirect('/enrichments/export');
  }
});

/* ------------------------------------------------------ device import */

router.get('/import', middleware.isLoggedIn, function (request, response) {
  response.render('enrichments/import', {
    status: importDevices.status(),
    importColumns: importDevices.COLUMNS,
  });
});

router.post('/import/devices', middleware.isLoggedIn, async function (request, response) {
  if (!request.files || !request.files.file) {
    request.flash('error', 'No file was uploaded');
    return response.redirect('/enrichments/import');
  }
  if (importDevices.isRunning()) {
    request.flash('warning', 'An import is already running');
    return response.redirect('/enrichments/import');
  }
  const file = request.files.file;
  const target = importEnrichment.uploadPath(file.name);
  try {
    await file.mv(target);
  } catch (error) {
    request.flash('error', 'Upload failed: ' + error.message);
    return response.redirect('/enrichments/import');
  }
  importDevices.start(target, {
    author: { id: request.user._id, email: request.user.email },
    sheet: (request.body && request.body.sheet) || undefined,
  }); // background
  request.flash('success', 'Import of ' + file.name + ' started');
  response.redirect('/enrichments/import');
});

router.get('/import/status', middleware.isLoggedIn, function (request, response) {
  response.json(importDevices.status());
});

/* --------------------------------------------------- secondPOP check */

router.get('/check/secondpop', middleware.isLoggedIn, async function (request, response, next) {
  const format = String(request.query.format || 'json').toLowerCase();
  if (format === 'csv' || format === 'xlsx') {
    try {
      await exporter.exportToResponse(response, {
        datasets: 'secondpop_check',
        format,
        query: request.query,
      });
    } catch (error) {
      next(error);
    }
    return;
  }
  const filter = filters.buildFilter(datasets.interfaces, request.query);
  response.json(
    await linkChecks.report(filter, { includeUnlinked: request.query.includeUnlinked === '1' })
  );
});

/* ------------------------------------------------------ external API */

router.get('/api/:dataset', apiOrSession, async function (request, response) {
  const spec = datasets.all[request.params.dataset];
  if (!spec) return response.status(404).json({ error: 'unknown dataset' });
  response.json(await pagination.paginatedResponse(request.query, spec));
});

router.post(
  '/api/interfaces/apiflag',
  apiOrSession,
  express.json(),
  async function (request, response) {
    const ids = Array.isArray(request.body && request.body.ids) ? request.body.ids : [];
    const flag =
      request.body && request.body.apiFlag !== undefined ? Boolean(request.body.apiFlag) : true;
    const valid = ids.filter((id) => /^[a-f0-9]{24}$/i.test(String(id)));
    const result = await Interface.updateMany({ _id: { $in: valid } }, { $set: { apiFlag: flag } });
    response.json({
      matched: result.matchedCount || 0,
      modified: result.modifiedCount || 0,
      apiFlag: flag,
    });
  }
);

/* ------------------------------------------- legacy enrichment import */

//NEW - show form to create new Enrichment
//should show the form will post data to /enrichments
router.get('/new', middleware.isLoggedIn, function (request, response) {
  response.render('enrichments/new');
});

//CREATE - add new enrichment to DB
router.post('/', middleware.isLoggedIn, async function (request, response) {
  logger.info('importing enrichment data');

  if (!request.files || !request.files.file)
    return response.status(400).send('No files were uploaded.');
  const sampleFile = request.files.file;
  const filename = sampleFile.name;
  logger.info('uploading enrichment file ' + filename);
  const target = importEnrichment.uploadPath(filename);
  try {
    await sampleFile.mv(target);
  } catch (err) {
    return response.status(500).send(err);
  }
  //check if we will create new collection or we will append on the old one
  //default is to append
  if (appendMode == false) {
    try {
      // permanent removal of the whole collection: audit entry first
      await audit.record({
        action: 'enrichment.clear',
        user: audit.actorOf(request),
        ip: request.ip,
        target: { type: 'enrichment', id: 'all', label: 'enrichment collection' },
        details: { removed: await Enrichment.countDocuments({}), replacedBy: filename },
      });
      await Enrichment.deleteMany({});
      logger.error('collection removed');
    } catch (error) {
      logger.error(error);
      return;
    }
    importEnrichment.createDocRecurse(target); // background, handles its own errors
    return;
  }
  importEnrichment.createDocRecurse(target); // background, handles its own errors
  response.redirect('/enrichments');
});

module.exports = router;
