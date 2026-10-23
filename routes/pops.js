const express = require('express');
const router = express.Router({ mergeParams: true });
const POP = require('../models/pop');
const middleware = require('../middleware');
const seedDB = require('../seeds');
const config = require('../config');
let aPOP = new POP();

//Mongoose PAGINATION
router.get('/pagination', middleware.isLoggedIn, async function (request, response) {
  let result;
  try {
    result = await POP.paginate(
      {},
      { select: 'name', lean: true, limit: 5000, offset: 0, customLabels: { totalDocs: 'total' } }
    );
  } catch (err) {
    result = undefined;
  }
  response.setHeader('Content-Type', 'application/json');
  response.send(JSON.stringify(result));
});
//INDEX - show all pops
router.get('/', middleware.isLoggedIn, async function (request, response) {
  let foundPOPs;
  try {
    foundPOPs = await POP.find({});
  } catch (error) {
    console.log(error);
    return;
  }
  response.render('pops/index', { pops: foundPOPs });
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
  const governorateAcro = request.body.pop.governorateAcro;
  const district = request.body.pop.district;
  const sector = request.body.pop.sector;

  aPOP = {
    name: name,
    shortName: shortName,
    governorateAcro: governorateAcro,
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
  //find POP with provided id
  let foundPOP;
  try {
    foundPOP = await POP.findById(request.params.id);
  } catch (error) {
    console.log(error);
    return;
  }
  //render show template with that POP
  response.render('pops/show', { pop: foundPOP });
});

//EDIT POP ROUTE
router.get('/:id/edit', async function (request, response) {
  //is user logged in?
  console.log('Update a POP');
  let foundPOP;
  try {
    foundPOP = await POP.findById(request.params.id);
  } catch (error) {
    foundPOP = undefined;
  }
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
