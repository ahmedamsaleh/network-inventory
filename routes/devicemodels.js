const express = require('express');
const audit = require('../services/audit');
const router = express.Router({ mergeParams: true });
const DeviceModel = require('../models/devicemodel');
const Device = require('../models/device');

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
const middleware = require('../middleware');
const pagination = require('../services/pagination');
const datasets = require('../services/datasets');

// bootstrap-table server-side pagination: GET /devicemodels/pagination?limit&offset&search&sort&order
router.get('/pagination', middleware.isLoggedIn, async function (request, response) {
  response.json(await pagination.paginatedResponse(request.query, datasets.devicemodels));
});

//INDEX - the list is loaded by the table from /devicemodels/pagination
router.get('/', middleware.isLoggedIn, function (request, response) {
  response.render('devicemodels/index');
});

//NEW
router.get('/new', middleware.isLoggedIn, function (request, response) {
  response.render('devicemodels/new', { types: DeviceModel.DEVICE_TYPES });
});

//CREATE
router.post('/', middleware.isLoggedIn, async function (request, response) {
  const values = DeviceModel.normalizeInput(request.body.devicemodel || {});
  values.author = { id: request.user._id, email: request.user.email };
  try {
    await DeviceModel.create(values);
  } catch (error) {
    request.flash('error', describeError(error));
    return response.redirect('/devicemodels/new');
  }
  request.flash('success', 'Successfully added device model');
  response.redirect('/devicemodels');
});

//SHOW
router.get('/:id', middleware.isLoggedIn, async function (request, response) {
  const model = await middleware.findByIdOr404(
    DeviceModel,
    request.params.id,
    response,
    'Device model',
    '/devicemodels'
  );
  if (!model) return;
  const deviceCount = await Device.countDocuments(
    Device.activeFilter({ model: new RegExp('^' + escapeRegExp(model.name) + '$', 'i') })
  );
  response.render('devicemodels/show', { model, deviceCount });
});

//EDIT
router.get('/:id/edit', middleware.isLoggedIn, async function (request, response) {
  const model = await middleware.findByIdOr404(
    DeviceModel,
    request.params.id,
    response,
    'Device model',
    '/devicemodels'
  );
  if (!model) return;
  response.render('devicemodels/edit', { model, types: DeviceModel.DEVICE_TYPES });
});

//UPDATE
router.put('/:id', middleware.isLoggedIn, async function (request, response) {
  const model = await middleware.findByIdOr404(
    DeviceModel,
    request.params.id,
    response,
    'Device model',
    '/devicemodels'
  );
  if (!model) return;
  model.set(DeviceModel.normalizeInput(request.body.devicemodel || {}));
  model.lastUpdate = new Date();
  try {
    await model.save();
  } catch (error) {
    request.flash('error', describeError(error));
    return response.redirect('/devicemodels/' + request.params.id + '/edit');
  }
  response.redirect('/devicemodels/' + request.params.id);
});

//DESTROY
router.delete('/:id', middleware.isLoggedIn, async function (request, response) {
  try {
    // the audit entry (with a snapshot) is written before the document is removed
    await audit.deleteById(request, 'devicemodel', DeviceModel, request.params.id);
  } catch (error) {
    request.flash('error', describeError(error));
  }
  response.redirect('/devicemodels');
});

function describeError(error) {
  if (error && error.code === 11000) return 'A device model with that name already exists';
  if (error && error.errors) {
    return Object.values(error.errors)
      .map((detail) => detail.message)
      .join(', ');
  }
  return error && error.message ? error.message : 'Something went wrong';
}

module.exports = router;
