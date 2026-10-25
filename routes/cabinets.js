const express = require('express');
const audit = require('../services/audit');
const router = express.Router({ mergeParams: true });
const Cabinet = require('../models/cabinet');
const POP = require('../models/pop');
const Device = require('../models/device');

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
const middleware = require('../middleware');
const pagination = require('../services/pagination');
const datasets = require('../services/datasets');

// bootstrap-table server-side pagination: GET /cabinets/pagination?limit&offset&search&sort&order
router.get('/pagination', middleware.isLoggedIn, async function (request, response) {
  response.json(await pagination.paginatedResponse(request.query, datasets.cabinets));
});

//INDEX - the list is loaded by the table from /cabinets/pagination
router.get('/', middleware.isLoggedIn, function (request, response) {
  response.render('cabinets/index');
});

//NEW - show form to create new cabinet
router.get('/new', middleware.isLoggedIn, function (request, response) {
  response.render('cabinets/new');
});

//CREATE - add new cabinet to DB
router.post('/', middleware.isLoggedIn, async function (request, response) {
  const values = Cabinet.normalizeInput(request.body.cabinet || {});
  values.author = { id: request.user._id, email: request.user.email };
  try {
    await Cabinet.create(values);
  } catch (error) {
    request.flash('error', describeError(error));
    return response.redirect('/cabinets/new');
  }
  request.flash('success', 'Successfully added cabinet');
  response.redirect('/cabinets');
});

//SHOW CABINET ROUTE
router.get('/:id', middleware.isLoggedIn, async function (request, response) {
  const cabinet = await middleware.findByIdOr404(
    Cabinet,
    request.params.id,
    response,
    'Cabinet',
    '/cabinets'
  );
  if (!cabinet) return;
  const [pop, deviceCount] = await Promise.all([
    cabinet.pop && cabinet.pop !== Cabinet.UNKNOWN
      ? POP.findOne({ shortName: cabinet.pop }).lean()
      : null,
    Device.countDocuments(
      Device.activeFilter({
        $or: [
          { cabinet: cabinet.cabinet },
          { hostname: new RegExp('^' + escapeRegExp(cabinet.cabinet) + '-', 'i') },
        ],
      })
    ),
  ]);
  response.render('cabinets/show', { cabinet, pop, deviceCount });
});

//EDIT CABINET ROUTE
router.get('/:id/edit', middleware.isLoggedIn, async function (request, response) {
  const cabinet = await middleware.findByIdOr404(
    Cabinet,
    request.params.id,
    response,
    'Cabinet',
    '/cabinets'
  );
  if (!cabinet) return;
  response.render('cabinets/edit', { cabinet });
});

//UPDATE CABINET ROUTE
router.put('/:id', middleware.isLoggedIn, async function (request, response) {
  const cabinet = await middleware.findByIdOr404(
    Cabinet,
    request.params.id,
    response,
    'Cabinet',
    '/cabinets'
  );
  if (!cabinet) return;
  cabinet.set(Cabinet.normalizeInput(request.body.cabinet || {}));
  cabinet.lastUpdate = new Date();
  try {
    await cabinet.save();
  } catch (error) {
    request.flash('error', describeError(error));
    return response.redirect('/cabinets/' + request.params.id + '/edit');
  }
  response.redirect('/cabinets/' + request.params.id);
});

//DESTROY CABINET ROUTE
router.delete('/:id', middleware.isLoggedIn, async function (request, response) {
  try {
    // the audit entry (with a snapshot) is written before the document is removed
    await audit.deleteById(request, 'cabinet', Cabinet, request.params.id);
  } catch (error) {
    request.flash('error', describeError(error));
  }
  response.redirect('/cabinets');
});

function describeError(error) {
  if (error && error.code === 11000) return 'A cabinet with that name already exists';
  if (error && error.errors) {
    return Object.values(error.errors)
      .map((detail) => detail.message)
      .join(', ');
  }
  return error && error.message ? error.message : 'Something went wrong';
}

module.exports = router;
