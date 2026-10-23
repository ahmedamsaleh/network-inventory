const express = require('express');
const router = express.Router({ mergeParams: true });
const Governorate = require('../models/governorate');
const middleware = require('../middleware');
const seedDB = require('../seeds');
const config = require('../config');
let aGovernorate = new Governorate();

//Mongoose PAGINATION
router.get('/pagination', middleware.isLoggedIn, async function (request, response) {
  let result;
  try {
    result = await Governorate.paginate(
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
  let foundGovernorates;
  try {
    foundGovernorates = await Governorate.find({});
  } catch (error) {
    console.log(error);
    return;
  }
  response.render('governorates/index', { governorates: foundGovernorates });
});
//NEW - show form to create new governorate
//should show the form will post data to /governorates
router.get('/new', middleware.isLoggedIn, function (request, response) {
  if (config.seed) {
    console.log('config.seed: ' + config.seed);
    seedDB(request.user);
  }
  response.render('governorates/new');
});

//CREATE - add new governorate to DB
router.post('/', middleware.isLoggedIn, async function (request, response) {
  //get data from a form and add to governorate array
  const name = request.body.governorate.name;
  const acronym = request.body.governorate.acronym;

  aGovernorate = {
    name: name,
    acronym: acronym,
    author: { id: request.user._id, email: request.user.email },
  };

  let createdGovernorate;
  try {
    createdGovernorate = await Governorate.create(aGovernorate);
  } catch (error) {
    console.log(error);
    request.flash('error', 'Something went wrong');
    return;
  }
  console.log(createdGovernorate);
  request.flash('success', 'Successfully added governorate');
  response.redirect('/governorates');
});
//SHOW GOVERNORATE ROUTE
router.get('/:id', middleware.isLoggedIn, async function (request, response) {
  //find Governorate with provided id
  let foundGovernorate;
  try {
    foundGovernorate = await Governorate.findById(request.params.id);
  } catch (error) {
    console.log(error);
    return;
  }
  //render show template with that governorate
  response.render('governorates/show', { governorate: foundGovernorate });
});

//EDIT GOVERNORATE ROUTE
router.get('/:id/edit', async function (request, response) {
  //is user logged in?
  console.log('Update a Governorate');
  let foundGovernorate;
  try {
    foundGovernorate = await Governorate.findById(request.params.id);
  } catch (error) {
    foundGovernorate = undefined;
  }
  response.render('governorates/edit', { governorate: foundGovernorate });
});
//UPDATE GOVERNORATE ROUTE
router.put('/:id', async function (request, response) {
  //find and update the correct Governorate
  try {
    await Governorate.findByIdAndUpdate(request.params.id, request.body.governorate);
  } catch (error) {
    console.log(error);
    return response.redirect('/governorates');
  }
  //redirect somewhere (show page)
  response.redirect('/governorates/' + request.params.id);
});
//DESTROY Governorate ROUTE
router.delete('/:id', async function (request, response) {
  if (request.params.id == -1) {
    response.redirect('/governorates');
  }

  try {
    await Governorate.findByIdAndDelete(request.params.id);
  } catch (error) {
    console.log(error);
  }
  response.redirect('/governorates');
});

module.exports = router;
