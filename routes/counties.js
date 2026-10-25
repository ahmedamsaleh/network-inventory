const express = require('express');
const audit = require('../services/audit');
const router = express.Router({ mergeParams: true });
const County = require('../models/county');
const Device = require('../models/device');
const POP = require('../models/pop');
const middleware = require('../middleware');
const seedDB = require('../seeds');
const config = require('../config');
const pagination = require('../services/pagination');
const datasets = require('../services/datasets');

// bootstrap-table server-side pagination: GET /counties/pagination?limit&offset&search&sort&order
// (also feeds the county picker of the device forms, public/javascript/select2-texture.js)
router.get('/pagination', middleware.isLoggedIn, async function (request, response) {
  response.json(await pagination.paginatedResponse(request.query, datasets.counties));
});
//INDEX - the list is loaded by the table from /counties/pagination
router.get('/', middleware.isLoggedIn, function (request, response) {
  response.render('counties/index');
});
//NEW - show form to create new county
router.get('/new', middleware.isLoggedIn, function (request, response) {
  if (config.seed) {
    seedDB(request.user);
  }
  response.render('counties/new');
});

//CREATE - add new county to DB
router.post('/', middleware.isLoggedIn, async function (request, response) {
  const fields = County.normalizeInput(request.body.county || {});
  let createdCounty;
  try {
    createdCounty = await County.create(
      Object.assign(fields, { author: { id: request.user._id, email: request.user.email } })
    );
  } catch (error) {
    // validation problems are user input: tell the user and return to the form
    request.flash('error', middleware.describeError(error));
    return response.redirect('/counties/new');
  }
  request.flash('success', 'Successfully added county ' + createdCounty.name);
  response.redirect('/counties');
});
//SHOW COUNTY ROUTE
router.get('/:id', middleware.isLoggedIn, async function (request, response) {
  const foundCounty = await middleware.findByIdOr404(
    County,
    request.params.id,
    response,
    'County',
    '/counties'
  );
  if (!foundCounty) return;
  const [deviceCount, popCount] = await Promise.all([
    Device.countDocuments(
      Device.activeFilter({
        $or: [{ 'county.id': foundCounty._id }, { 'county.name': foundCounty.name }],
      })
    ),
    foundCounty.acronym ? POP.countDocuments({ cty: foundCounty.acronym }) : 0,
  ]);
  response.render('counties/show', { county: foundCounty, deviceCount, popCount });
});

//EDIT COUNTY ROUTE
router.get('/:id/edit', async function (request, response) {
  const foundCounty = await middleware.findByIdOr404(
    County,
    request.params.id,
    response,
    'County',
    '/counties'
  );
  if (!foundCounty) return;
  response.render('counties/edit', { county: foundCounty });
});
//UPDATE COUNTY ROUTE
router.put('/:id', async function (request, response) {
  const fields = County.normalizeInput(request.body.county || {});
  try {
    const updated = await County.findByIdAndUpdate(request.params.id, fields, {
      runValidators: true,
      new: true,
    });
    if (!updated) {
      request.flash('error', 'County not found');
      return response.redirect('/counties');
    }
  } catch (error) {
    request.flash('error', middleware.describeError(error));
    return response.redirect('/counties/' + request.params.id + '/edit');
  }
  request.flash('success', 'County updated');
  response.redirect('/counties/' + request.params.id);
});

//DESTROY COUNTY ROUTE
router.delete('/:id', async function (request, response) {
  if (request.params.id == -1) {
    return response.redirect('/counties');
  }
  try {
    // the audit entry (with a snapshot) is written before the document is removed
    await audit.deleteById(request, 'county', County, request.params.id);
  } catch (error) {
    request.flash('error', 'Delete failed (nothing was removed): ' + error.message);
  }
  response.redirect('/counties');
});

module.exports = router;
