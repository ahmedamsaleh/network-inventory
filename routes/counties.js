const express = require('express');
const router = express.Router({ mergeParams: true });
const County = require('../models/county');
const middleware = require('../middleware');
const seedDB = require('../seeds');
const config = require('../config');
let aCounty = new County();

//Mongoose PAGINATION
router.get('/pagination', middleware.isLoggedIn, async function (request, response) {
  let result;
  try {
    result = await County.paginate(
      {},
      { select: 'name', lean: true, limit: 500, offset: 0, customLabels: { totalDocs: 'total' } }
    );
  } catch (err) {
    result = undefined;
  }
  response.setHeader('Content-Type', 'application/json');
  response.send(JSON.stringify(result));
});
//INDEX - show all pops
router.get('/', middleware.isLoggedIn, async function (request, response) {
  let foundCounties;
  try {
    foundCounties = await County.find({});
  } catch (error) {
    console.log(error);
    return;
  }
  response.render('counties/index', { counties: foundCounties });
});
//NEW - show form to create new county
//should show the form will post data to /counties
router.get('/new', middleware.isLoggedIn, function (request, response) {
  if (config.seed) {
    console.log('config.seed: ' + config.seed);
    seedDB(request.user);
  }
  response.render('counties/new');
});

//CREATE - add new county to DB
router.post('/', middleware.isLoggedIn, async function (request, response) {
  //get data from a form and add to county array
  const name = request.body.county.name;
  const acronym = request.body.county.acronym;

  aCounty = {
    name: name,
    acronym: acronym,
    author: { id: request.user._id, email: request.user.email },
  };

  let createdCounty;
  try {
    createdCounty = await County.create(aCounty);
  } catch (error) {
    console.log(error);
    request.flash('error', 'Something went wrong');
    return;
  }
  console.log(createdCounty);
  request.flash('success', 'Successfully added county');
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
  response.render('counties/show', { county: foundCounty });
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
  //find and update the correct County
  try {
    await County.findByIdAndUpdate(request.params.id, request.body.county);
  } catch (error) {
    console.log(error);
    return response.redirect('/counties');
  }
  //redirect somewhere (show page)
  response.redirect('/counties/' + request.params.id);
});
//DESTROY County ROUTE
router.delete('/:id', async function (request, response) {
  if (request.params.id == -1) {
    response.redirect('/counties');
  }

  try {
    await County.findByIdAndDelete(request.params.id);
  } catch (error) {
    console.log(error);
  }
  response.redirect('/counties');
});

module.exports = router;
