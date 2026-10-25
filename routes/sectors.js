const express = require('express');
const audit = require('../services/audit');
const router = express.Router({ mergeParams: true });
const Sector = require('../models/sector');
const Device = require('../models/device');
const middleware = require('../middleware');
const seedDB = require('../seeds');
const config = require('../config');
const pagination = require('../services/pagination');
const datasets = require('../services/datasets');

// bootstrap-table server-side pagination: GET /sectors/pagination?limit&offset&search&sort&order
// (also feeds the sector picker of the device forms, public/javascript/select2-texture.js)
router.get('/pagination', middleware.isLoggedIn, async function (request, response) {
  response.json(await pagination.paginatedResponse(request.query, datasets.sectors));
});
//INDEX - the sector list is loaded by the table from /sectors/pagination
router.get('/', middleware.isLoggedIn, function (request, response) {
  response.render('sectors/index');
});

//NEW - show form to create new Sector
router.get('/new', middleware.isLoggedIn, function (request, response) {
  if (config.seed) {
    seedDB(request.user);
  }
  response.render('sectors/new');
});

//CREATE - add new sector to DB
router.post('/', middleware.isLoggedIn, async function (request, response) {
  const fields = Sector.normalizeInput(request.body.sector || {});
  let createdSector;
  try {
    createdSector = await Sector.create(
      Object.assign(fields, { author: { id: request.user._id, email: request.user.email } })
    );
  } catch (error) {
    // validation problems are user input: tell the user and return to the form
    request.flash('error', middleware.describeError(error));
    return response.redirect('/sectors/new');
  }
  request.flash('success', 'Successfully added sector ' + createdSector.name);
  response.redirect('/sectors');
});

//SHOW SECTOR ROUTE
router.get('/:id', middleware.isLoggedIn, async function (request, response) {
  const foundSector = await middleware.findByIdOr404(
    Sector,
    request.params.id,
    response,
    'Sector',
    '/sectors'
  );
  if (!foundSector) return;
  const deviceCount = await Device.countDocuments(
    Device.activeFilter({
      $or: [{ 'sector.id': foundSector._id }, { 'sector.name': foundSector.name }],
    })
  );
  response.render('sectors/show', { sector: foundSector, deviceCount });
});

//EDIT SECTOR ROUTE
router.get('/:id/edit', async function (request, response) {
  const foundSector = await middleware.findByIdOr404(
    Sector,
    request.params.id,
    response,
    'Sector',
    '/sectors'
  );
  if (!foundSector) return;
  response.render('sectors/edit', { sector: foundSector });
});
//UPDATE SECTOR ROUTE
router.put('/:id', async function (request, response) {
  const fields = Sector.normalizeInput(request.body.sector || {});
  try {
    const updated = await Sector.findByIdAndUpdate(request.params.id, fields, {
      runValidators: true,
      new: true,
    });
    if (!updated) {
      request.flash('error', 'Sector not found');
      return response.redirect('/sectors');
    }
  } catch (error) {
    request.flash('error', middleware.describeError(error));
    return response.redirect('/sectors/' + request.params.id + '/edit');
  }
  request.flash('success', 'Sector updated');
  response.redirect('/sectors/' + request.params.id);
});

//DESTROY SECTOR ROUTE
router.delete('/:id', async function (request, response) {
  if (request.params.id == -1) {
    return response.redirect('/sectors');
  }
  try {
    // the audit entry (with a snapshot) is written before the document is removed
    await audit.deleteById(request, 'sector', Sector, request.params.id);
  } catch (error) {
    request.flash('error', 'Delete failed (nothing was removed): ' + error.message);
  }
  response.redirect('/sectors');
});

module.exports = router;
