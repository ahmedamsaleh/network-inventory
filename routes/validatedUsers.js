const express = require('express');
const router = express.Router({ mergeParams: true });
// let User  = require("../models/user");
const ValidatedUser = require('../models/validatedUser');
const middleware = require('../middleware');
const seedDB = require('../seeds');
const config = require('../config');
let aValidatedUser = new ValidatedUser();

//INDEX - show all Users
router.get('/', middleware.isLoggedIn, async function (request, response) {
  let foundUsers;
  try {
    foundUsers = await ValidatedUser.find({});
  } catch (error) {
    console.log(error);
    return;
  }
  response.render('validatedusers/index', { users: foundUsers });
});

//NEW - show form to create new User
//should show the form will post data to /users
router.get('/new', middleware.isLoggedIn, function (request, response) {
  if (config.seed) {
    console.log('config.seed: ' + config.seed);
    seedDB(request.user);
  }
  response.render('validatedusers/new');
});
//CREATE - add new User to the validation collection
router.post('/', middleware.isLoggedIn, async function (request, response) {
  //get data from a form and add to User array
  const email = request.body.user.email;
  const role = request.body.user.role;
  const name = request.body.user.name;
  // ValidatedUser
  aValidatedUser = {
    name: name,
    email: email,
    role: role,
    author: { id: request.user._id, email: request.user.email },
  };

  try {
    await ValidatedUser.create(aValidatedUser);
  } catch (error) {
    console.log(error);
    request.flash('error', 'Something went wrong');
    return;
  }
  console.log('new User created in the validation collection and saved');
  request.flash('success', 'Successfully added User to list of validated users');
  response.redirect('/validatedusers');
});

//SHOW Validated User ROUTE
router.get('/:id', middleware.isLoggedIn, async function (request, response) {
  //find Validated User with provided id
  let foundUser;
  try {
    foundUser = await ValidatedUser.findById(request.params.id);
  } catch (error) {
    console.log(error);
    return;
  }
  //render show template with that Validated User
  response.render('validatedusers/show', { user: foundUser });
});

//EDIT VALIDATED USER ROUTE
router.get('/:id/edit', async function (request, response) {
  //is user logged in?
  console.log('Update a VALIDATED USER');
  let foundUser;
  try {
    foundUser = await ValidatedUser.findById(request.params.id);
  } catch (error) {
    foundUser = undefined;
  }
  response.render('validatedusers/edit', { user: foundUser });
});
//UPDATE VALIDATED USER ROUTE
router.put('/:id', async function (request, response) {
  //find and update the correct VALIDATED USER
  try {
    await ValidatedUser.findByIdAndUpdate(request.params.id, request.body.user);
  } catch (error) {
    console.log(error);
    return response.redirect('/validatedusers');
  }
  //redirect somewhere (show page)
  response.redirect('/validatedusers/' + request.params.id);
});

//DESTROY VALIDATED USER ROUTE
router.delete('/:id', async function (request, response) {
  if (request.params.id == -1) {
    response.redirect('/validatedusers');
  }

  console.log('Deleting Validated User with id: ' + request.params.id);
  try {
    await ValidatedUser.findByIdAndDelete(request.params.id);
  } catch (error) {
    console.log(error);
  }
  response.redirect('/validatedusers');
});

module.exports = router;
