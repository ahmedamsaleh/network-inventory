const express = require('express');
const audit = require('../services/audit');
const router = express.Router({ mergeParams: true });
const ValidatedUser = require('../models/validatedUser');
const User = require('../models/user');
const middleware = require('../middleware');
const seedDB = require('../seeds');
const config = require('../config');
const pagination = require('../services/pagination');
const datasets = require('../services/datasets');

// bootstrap-table server-side pagination
router.get('/pagination', middleware.isLoggedIn, async function (request, response) {
  response.json(await pagination.paginatedResponse(request.query, datasets.validatedusers));
});
//INDEX - the list is loaded by the table from /validatedusers/pagination
router.get('/', middleware.isLoggedIn, function (request, response) {
  response.render('validatedusers/index');
});

//NEW - show form to whitelist a User
router.get('/new', middleware.isLoggedIn, function (request, response) {
  if (config.seed) {
    seedDB(request.user);
  }
  response.render('validatedusers/new', { roles: ValidatedUser.ROLES });
});
//CREATE - add new User to the validation collection
router.post('/', middleware.isLoggedIn, async function (request, response) {
  const fields = ValidatedUser.normalizeInput(request.body.user || {});
  try {
    if (fields.email && (await ValidatedUser.findOne({ email: fields.email }))) {
      request.flash('error', fields.email + ' is already on the list of validated users');
      return response.redirect('/validatedusers/new');
    }
    await ValidatedUser.create(
      Object.assign(fields, { author: { id: request.user._id, email: request.user.email } })
    );
  } catch (error) {
    // validation problems are user input: tell the user and return to the form
    request.flash('error', middleware.describeError(error));
    return response.redirect('/validatedusers/new');
  }
  request.flash('success', 'Successfully added ' + fields.email + ' to the validated users');
  response.redirect('/validatedusers');
});

//SHOW VALIDATED USER ROUTE
router.get('/:id', middleware.isLoggedIn, async function (request, response) {
  const foundUser = await middleware.findByIdOr404(
    ValidatedUser,
    request.params.id,
    response,
    'Validated user',
    '/validatedusers'
  );
  if (!foundUser) return;
  const account = await User.findOne({ email: foundUser.email }, { isAuthenticated: 1 }).lean();
  response.render('validatedusers/show', { user: foundUser, account });
});

//EDIT VALIDATED USER ROUTE
router.get('/:id/edit', async function (request, response) {
  const foundUser = await middleware.findByIdOr404(
    ValidatedUser,
    request.params.id,
    response,
    'Validated user',
    '/validatedusers'
  );
  if (!foundUser) return;
  response.render('validatedusers/edit', { user: foundUser, roles: ValidatedUser.ROLES });
});
//UPDATE VALIDATED USER ROUTE
router.put('/:id', async function (request, response) {
  const fields = ValidatedUser.normalizeInput(request.body.user || {});
  try {
    const updated = await ValidatedUser.findByIdAndUpdate(request.params.id, fields, {
      runValidators: true,
      new: true,
    });
    if (!updated) {
      request.flash('error', 'Validated user not found');
      return response.redirect('/validatedusers');
    }
  } catch (error) {
    request.flash('error', middleware.describeError(error));
    return response.redirect('/validatedusers/' + request.params.id + '/edit');
  }
  request.flash('success', 'Validated user updated');
  response.redirect('/validatedusers/' + request.params.id);
});

//DESTROY VALIDATED USER ROUTE
router.delete('/:id', async function (request, response) {
  if (request.params.id == -1) {
    return response.redirect('/validatedusers');
  }
  try {
    // the audit entry (with a snapshot) is written before the document is removed
    await audit.deleteById(request, 'validateduser', ValidatedUser, request.params.id);
  } catch (error) {
    request.flash('error', 'Delete failed (nothing was removed): ' + error.message);
  }
  response.redirect('/validatedusers');
});

module.exports = router;
