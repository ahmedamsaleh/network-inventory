const express = require('express');
const audit = require('../services/audit');
const router = express.Router({ mergeParams: true });
const POP = require('../models/pop');
const Device = require('../models/device');
const Cabinet = require('../models/cabinet');
const middleware = require('../middleware');
const seedDB = require('../seeds');
const config = require('../config');
const pagination = require('../services/pagination');
const datasets = require('../services/datasets');
const importEnrichment = require('../middleware/import_enrichment');
let aPOP = new POP();

// bootstrap-table server-side pagination: GET /pops/pagination?limit&offset&search&sort&order
// (also used by the select2 pickers on the device forms, see public/javascript/select2-texture.js)
router.get('/pagination', middleware.isLoggedIn, async function (request, response) {
  response.json(await pagination.paginatedResponse(request.query, datasets.pops));
});
//INDEX - the POP list is loaded by the table from /pops/pagination
router.get('/', middleware.isLoggedIn, function (request, response) {
  response.render('pops/index');
});
//NEW - show form to create new POP
//should show the form will post data to /pops
router.get('/new', middleware.isLoggedIn, function (request, response) {
  if (config.seed) {
    seedDB(request.user);
  }
  response.render('pops/new');
});

//CREATE - add new POP to DB
router.post('/', middleware.isLoggedIn, async function (request, response) {
  //get data from a form and add to POP array
  aPOP = Object.assign(POP.normalizeInput(request.body.pop || {}), {
    author: { id: request.user._id, email: request.user.email },
  });

  let createdPOP;
  try {
    createdPOP = await POP.create(aPOP);
  } catch (error) {
    // validation problems are user input: tell the user and return to the form
    request.flash('error', middleware.describeError(error));
    return response.redirect('/pops/new');
  }
  request.flash('success', 'Successfully added POP ' + createdPOP.name);
  response.redirect('/pops');
});

// IMPORT - "POPs" sheet (CSV: shortName, cty, district, sector, popType, popLongName)
router.post('/import', middleware.isLoggedIn, async function (request, response) {
  if (!request.files || !request.files.file) {
    request.flash('error', 'No file was uploaded');
    return response.redirect('/pops');
  }
  const file = request.files.file;
  const target = importEnrichment.uploadPath(file.name);
  try {
    await file.mv(target);
  } catch (error) {
    return response.status(500).send(error.message);
  }
  const summary = await importEnrichment.importPops(target, {
    author: { id: request.user._id, email: request.user.email },
  });
  if (summary.errors.length) {
    request.flash('error', 'POP import: ' + summary.errors.slice(0, 5).join(' | '));
  }
  request.flash(
    'success',
    'POP import: ' +
      summary.created +
      ' created, ' +
      summary.updated +
      ' updated, ' +
      summary.skipped +
      ' skipped'
  );
  response.redirect('/pops');
});

//SHOW POP ROUTE
router.get('/:id', middleware.isLoggedIn, async function (request, response) {
  const foundPOP = await middleware.findByIdOr404(POP, request.params.id, response, 'POP', '/pops');
  if (!foundPOP) return;
  const [devices, cabinets] = await Promise.all([
    Device.countDocuments(
      Device.activeFilter({ $or: [{ 'popName.id': foundPOP._id }, { pop: foundPOP.shortName }] })
    ),
    Cabinet.find({ pop: foundPOP.shortName }, { cabinet: 1 }).sort({ cabinet: 1 }).lean(),
  ]);
  response.render('pops/show', { pop: foundPOP, usage: { devices, cabinets } });
});

//EDIT POP ROUTE
router.get('/:id/edit', async function (request, response) {
  const foundPOP = await middleware.findByIdOr404(POP, request.params.id, response, 'POP', '/pops');
  if (!foundPOP) return;
  response.render('pops/edit', { pop: foundPOP });
});
//UPDATE POP ROUTE
router.put('/:id', async function (request, response) {
  //find and update the correct POP
  try {
    const current = await POP.findById(request.params.id).lean();
    if (!current) {
      request.flash('error', 'POP not found');
      return response.redirect('/pops');
    }
    await POP.findByIdAndUpdate(
      request.params.id,
      POP.normalizeInput(request.body.pop || {}, current),
      { runValidators: true }
    );
  } catch (error) {
    request.flash('error', middleware.describeError(error));
    return response.redirect('/pops/' + request.params.id + '/edit');
  }
  request.flash('success', 'POP updated');
  response.redirect('/pops/' + request.params.id);
});

//DESTROY POP ROUTE
router.delete('/:id', async function (request, response) {
  if (request.params.id == -1) {
    return response.redirect('/pops');
  }

  try {
    // the audit entry (with a snapshot) is written before the document is removed
    await audit.deleteById(request, 'pop', POP, request.params.id);
  } catch (error) {
    request.flash('error', 'Delete failed (nothing was removed): ' + error.message);
  }
  response.redirect('/pops');
});

module.exports = router;
