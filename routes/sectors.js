const express = require('express');
const router = express.Router({ mergeParams: true });
const Sector = require('../models/sector');
const middleware = require('../middleware');
const seedDB = require('../seeds');
const config = require('../config');
let aSector = new Sector();

//Mongoose PAGINATION
router.get('/pagination', middleware.isLoggedIn, async function (request, response) {
  let result;
  try {
    result = await Sector.paginate(
      {},
      { select: 'name', lean: true, limit: 500, offset: 0, customLabels: { totalDocs: 'total' } }
    );
  } catch (err) {
    result = undefined;
  }
  response.setHeader('Content-Type', 'application/json');
  response.send(JSON.stringify(result));
});
//INDEX - show all Sectors
router.get('/', middleware.isLoggedIn, async function (request, response) {
  let foundSectors;
  try {
    foundSectors = await Sector.find({});
  } catch (error) {
    console.log(error);
    return;
  }
  response.render('sectors/index', { sectors: foundSectors });
});

//NEW - show form to create new Sector
//should show the form will post data to /sectors
router.get('/new', middleware.isLoggedIn, function (request, response) {
  if (config.seed) {
    console.log('config.seed: ' + config.seed);
    seedDB(request.user);
  }
  response.render('sectors/new');
});

//CREATE - add new sector to DB
router.post('/', middleware.isLoggedIn, async function (request, response) {
  //get data from a form and add to sector array
  const name = request.body.sector.name;
  const description = request.body.sector.description;

  aSector = {
    name: name,
    shortName: description,
    author: { id: request.user._id, email: request.user.email },
  };

  console.log(aSector);
  let createdSector;
  try {
    createdSector = await Sector.create(aSector);
  } catch (error) {
    console.log(error);
    request.flash('error', 'Something went wrong');
    return;
  }
  console.log('new Sector created and saved');
  console.log(createdSector);
  request.flash('success', 'Successfully added Sector');
  response.redirect('/sectors');
});

//SHOW SECTOR ROUTE
router.get('/:id', middleware.isLoggedIn, async function (request, response) {
  //find SECTOR with provided id
  let foundSector;
  try {
    foundSector = await Sector.findById(request.params.id);
  } catch (error) {
    console.log(error);
    return;
  }
  //render show template with that SECTOR
  response.render('sectors/show', { sector: foundSector });
});

//EDIT SECTOR ROUTE
router.get('/:id/edit', async function (request, response) {
  //is user logged in?
  console.log('Update a SECTOR');
  let foundSector;
  try {
    foundSector = await Sector.findById(request.params.id);
  } catch (error) {
    foundSector = undefined;
  }
  response.render('sectors/edit', { sector: foundSector });
});
//UPDATE SECTOR ROUTE
router.put('/:id', async function (request, response) {
  //find and update the correct SECTOR
  try {
    await Sector.findByIdAndUpdate(request.params.id, request.body.sector);
  } catch (error) {
    console.log(error);
    return response.redirect('/sectors');
  }
  //redirect somewhere (show page)
  response.redirect('/sectors/' + request.params.id);
});

//DESTROY SECTOR ROUTE
router.delete('/:id', async function (request, response) {
  if (request.params.id == -1) {
    response.redirect('/sectors');
  }

  console.log('Deleting SECTOR with id: ' + request.params.id);
  try {
    await Sector.findByIdAndDelete(request.params.id);
  } catch (error) {
    console.log(error);
  }
  response.redirect('/sectors');
});

module.exports = router;
