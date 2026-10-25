const express = require('express');
const router = express.Router({ mergeParams: true });
const Link = require('../models/link');
const middleware = require('../middleware');
let aLink = new Link();
const seedDB = require('../seeds');
const config = require('../config');

//INDEX - show all pops
router.get('/', middleware.isLoggedIn, async function (request, response) {
  let foundLinks;
  try {
    foundLinks = await Link.find({});
  } catch (error) {
    console.log(error);
    return;
  }
  response.render('links/index', { links: foundLinks });
});

//NEW - show form to create new Link
//should show the form will post data to /links
router.get('/new', middleware.isLoggedIn, function (request, response) {
  if (config.seed) {
    console.log('config.seed: ' + config.seed);
    seedDB(request.user);
  }
  response.render('links/new');
});

//CREATE - add new link to DB
router.post('/', middleware.isLoggedIn, async function (request, response) {
  //get data from a form and add to link array
  const device1 = request.body.link.device1;
  const interface1 = request.body.link.interface1;
  const device2 = request.body.link.device2;
  const interface2 = request.body.link.interface2;

  aLink = {
    device1: device1,
    interface1: interface1,
    device2: device2,
    interface2: interface2,
    author: { id: request.user._id, email: request.user.email },
  };

  console.log(aLink);
  let createdLink;
  try {
    createdLink = await Link.create(aLink);
  } catch (error) {
    console.log(error);
    request.flash('error', 'Something went wrong');
    return;
  }
  console.log('new link created and saved');
  console.log(createdLink);
  request.flash('success', 'Successfully added link');
  response.redirect('/links');
});
//SHOW LINK ROUTE
router.get('/:id', middleware.isLoggedIn, async function (request, response) {
  const foundLink = await middleware.findByIdOr404(
    Link,
    request.params.id,
    response,
    'Link',
    '/links'
  );
  if (!foundLink) return;
  response.render('links/show', { link: foundLink });
});

//EDIT LINK ROUTE
router.get('/:id/edit', async function (request, response) {
  const foundLink = await middleware.findByIdOr404(
    Link,
    request.params.id,
    response,
    'Link',
    '/links'
  );
  if (!foundLink) return;
  response.render('links/edit', { link: foundLink });
});
//UPDATE LINK ROUTE
router.put('/:id', async function (request, response) {
  //find and update the correct Link
  try {
    await Link.findByIdAndUpdate(request.params.id, request.body.link);
  } catch (error) {
    console.log(error);
    return response.redirect('/links');
  }
  //redirect somewhere (show page)
  response.redirect('/links/' + request.params.id);
});

//DESTROY LINK ROUTE
router.delete('/:id', async function (request, response) {
  if (request.params.id == -1) {
    response.redirect('/links');
  }

  console.log('Deleting link with id: ' + request.params.id);
  try {
    await Link.findByIdAndDelete(request.params.id);
  } catch (error) {
    console.log(error);
  }
  response.redirect('/links');
});

module.exports = router;
