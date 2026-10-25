const express = require('express');
const audit = require('../services/audit');
const router = express.Router({ mergeParams: true });
const BTMSANInfo = require('../models/btmsaninfo');
const Device = require('../models/device');
const middleware = require('../middleware');
const pagination = require('../services/pagination');
const datasets = require('../services/datasets');

// bootstrap-table server-side pagination: GET /btmsaninfos/pagination?limit&offset&search&sort&order
router.get('/pagination', middleware.isLoggedIn, async function (request, response) {
  response.json(await pagination.paginatedResponse(request.query, datasets.btmsaninfos));
});

//INDEX - the list is loaded by the table from /btmsaninfos/pagination
router.get('/', middleware.isLoggedIn, function (request, response) {
  response.render('btmsaninfos/index');
});

//NEW
router.get('/new', middleware.isLoggedIn, function (request, response) {
  response.render('btmsaninfos/new');
});

//CREATE
router.post('/', middleware.isLoggedIn, async function (request, response) {
  const values = BTMSANInfo.normalizeInput(request.body.btmsaninfo || {});
  values.author = { id: request.user._id, email: request.user.email };
  try {
    await BTMSANInfo.create(values);
  } catch (error) {
    request.flash('error', middleware.describeError(error));
    return response.redirect('/btmsaninfos/new');
  }
  request.flash('success', 'Successfully added BT MSAN info');
  response.redirect('/btmsaninfos');
});

//SHOW
router.get('/:id', middleware.isLoggedIn, async function (request, response) {
  const info = await middleware.findByIdOr404(
    BTMSANInfo,
    request.params.id,
    response,
    'BT MSAN info',
    '/btmsaninfos'
  );
  if (!info) return;
  const device = info.mngIP
    ? await Device.findOne(Device.activeFilter({ ipaddress: info.mngIP }), {
        hostname: 1,
        ipaddress: 1,
      }).lean()
    : null;
  response.render('btmsaninfos/show', { info, device });
});

//EDIT
router.get('/:id/edit', middleware.isLoggedIn, async function (request, response) {
  const info = await middleware.findByIdOr404(
    BTMSANInfo,
    request.params.id,
    response,
    'BT MSAN info',
    '/btmsaninfos'
  );
  if (!info) return;
  response.render('btmsaninfos/edit', { info });
});

//UPDATE
router.put('/:id', middleware.isLoggedIn, async function (request, response) {
  const info = await middleware.findByIdOr404(
    BTMSANInfo,
    request.params.id,
    response,
    'BT MSAN info',
    '/btmsaninfos'
  );
  if (!info) return;
  info.set(BTMSANInfo.normalizeInput(request.body.btmsaninfo || {}));
  info.lastUpdate = new Date();
  try {
    await info.save();
  } catch (error) {
    request.flash('error', middleware.describeError(error));
    return response.redirect('/btmsaninfos/' + request.params.id + '/edit');
  }
  response.redirect('/btmsaninfos/' + request.params.id);
});

//DESTROY
router.delete('/:id', middleware.isLoggedIn, async function (request, response) {
  try {
    // the audit entry (with a snapshot) is written before the document is removed
    await audit.deleteById(request, 'btmsaninfo', BTMSANInfo, request.params.id);
  } catch (error) {
    request.flash('error', middleware.describeError(error));
  }
  response.redirect('/btmsaninfos');
});

module.exports = router;
