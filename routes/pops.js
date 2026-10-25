const express = require('express');
const router = express.Router({ mergeParams: true });
const POP = require('../models/pop');
const middleware = require('../middleware');
const seedDB = require('../seeds');
const config = require('../config');
const pagination = require('../services/pagination');
let aPOP = new POP();

// bootstrap-table server-side pagination: GET /pops/pagination?limit&offset&search&sort&order
// (also used by the select2 pickers on the device forms, see public/javascript/select2-texture.js)
const popPaginationSpec = {
  Model: POP,
  searchFields: ['name', 'shortName', 'district', 'countyAcro.acronym', 'sector.name'],
  sortable: {
    name: 'name',
    acronym: 'shortName',
    county: 'countyAcro.acronym',
    district: 'district',
    sector: 'sector.name',
  },
  defaultSort: 'name',
  // only what views/pops/index.ejs displays
  projection: {
    name: 1,
    shortName: 1,
    'countyAcro.acronym': 1,
    district: 1,
    'sector.name': 1,
  },
  mapRow: function (pop) {
    return {
      _id: String(pop._id),
      id: String(pop._id), // select2 option id
      name: pop.name,
      acronym: pop.shortName,
      county: pop.countyAcro && pop.countyAcro.acronym,
      district: pop.district,
      sector: pop.sector && pop.sector.name,
    };
  },
};
router.get('/pagination', middleware.isLoggedIn, async function (request, response) {
  response.json(await pagination.paginatedResponse(request.query, popPaginationSpec));
});
//INDEX - the POP list is loaded by the table from /pops/pagination
router.get('/', middleware.isLoggedIn, function (request, response) {
  response.render('pops/index');
});
//NEW - show form to create new POP
//should show the form will post data to /pops
router.get('/new', middleware.isLoggedIn, function (request, response) {
  if (config.seed) {
    console.log('config.seed: ' + config.seed);
    seedDB(request.user);
  }
  response.render('pops/new');
});

//CREATE - add new POP to DB
router.post('/', middleware.isLoggedIn, async function (request, response) {
  //get data from a form and add to POP array
  const name = request.body.pop.name;
  const shortName = request.body.pop.shortName;
  const countyAcro = request.body.pop.countyAcro;
  const district = request.body.pop.district;
  const sector = request.body.pop.sector;

  aPOP = {
    name: name,
    shortName: shortName,
    countyAcro: countyAcro,
    district: district,
    sector: sector,
    author: { id: request.user._id, email: request.user.email },
  };

  console.log(aPOP);
  let createdPOP;
  try {
    createdPOP = await POP.create(aPOP);
  } catch (error) {
    console.log(error);
    request.flash('error', 'Something went wrong');
    return;
  }
  console.log('new POP created and saved');
  console.log(createdPOP);
  request.flash('success', 'Successfully added POP');
  response.redirect('/pops');
});

//SHOW POP ROUTE
router.get('/:id', middleware.isLoggedIn, async function (request, response) {
  const foundPOP = await middleware.findByIdOr404(POP, request.params.id, response, 'POP', '/pops');
  if (!foundPOP) return;
  response.render('pops/show', { pop: foundPOP });
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
    await POP.findByIdAndUpdate(request.params.id, request.body.pop);
  } catch (error) {
    console.log(error);
    return response.redirect('/pops');
  }
  //redirect somewhere (show page)
  response.redirect('/pops/' + request.params.id);
});

//DESTROY POP ROUTE
router.delete('/:id', async function (request, response) {
  if (request.params.id == -1) {
    response.redirect('/pops');
  }

  console.log('Deleting POP with id: ' + request.params.id);
  try {
    await POP.findByIdAndDelete(request.params.id);
  } catch (error) {
    console.log(error);
  }
  response.redirect('/pops');
});

module.exports = router;
