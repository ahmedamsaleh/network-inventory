const express = require('express');
const audit = require('../services/audit');
const router = express.Router({ mergeParams: true });
const User = require('../models/user');
const ValidatedUser = require('../models/validatedUser');
const middleware = require('../middleware');
const pagination = require('../services/pagination');
const datasets = require('../services/datasets');

// bootstrap-table server-side pagination
router.get('/pagination', middleware.isLoggedIn, async function (request, response) {
  response.json(await pagination.paginatedResponse(request.query, datasets.users));
});
//INDEX - the list is loaded by the table from /users/pagination
router.get('/', middleware.isLoggedIn, function (request, response) {
  response.render('users/index');
});

//SHOW USER ROUTE
router.get('/:id', middleware.isLoggedIn, async function (request, response) {
  const foundUser = await middleware.findByIdOr404(
    User,
    request.params.id,
    response,
    'User',
    '/users'
  );
  if (!foundUser) return;
  response.render('users/show', { user: foundUser });
});

//EDIT USER ROUTE (name / role) - administrators only
router.get('/:id/edit', middleware.isAdmin, async function (request, response) {
  const foundUser = await middleware.findByIdOr404(
    User,
    request.params.id,
    response,
    'User',
    '/users'
  );
  if (!foundUser) return;
  response.render('users/edit', { user: foundUser, roles: ValidatedUser.ROLES });
});
//UPDATE USER ROUTE
router.put('/:id', middleware.isAdmin, async function (request, response) {
  const form = request.body.user || {};
  const fields = {};
  if (form.name !== undefined) fields.name = String(form.name).trim();
  if (form.role !== undefined) fields.role = String(form.role).trim();
  if (fields.name === '') {
    request.flash('error', 'Name is required');
    return response.redirect('/users/' + request.params.id + '/edit');
  }
  if (fields.role !== undefined && !ValidatedUser.ROLES.includes(fields.role)) {
    request.flash('error', 'Role must be admin or operator');
    return response.redirect('/users/' + request.params.id + '/edit');
  }
  try {
    const updated = await User.findByIdAndUpdate(request.params.id, fields, { new: true });
    if (!updated) {
      request.flash('error', 'User not found');
      return response.redirect('/users');
    }
  } catch (error) {
    request.flash('error', middleware.describeError(error));
    return response.redirect('/users/' + request.params.id + '/edit');
  }
  request.flash('success', 'User updated');
  response.redirect('/users/' + request.params.id);
});

//DESTROY USER ROUTE
router.delete('/:id', async function (request, response) {
  if (request.params.id == -1) {
    return response.redirect('/users');
  }
  try {
    // the audit entry (with a snapshot) is written before the document is removed
    await audit.deleteById(request, 'user', User, request.params.id);
  } catch (error) {
    request.flash('error', 'Delete failed (nothing was removed): ' + error.message);
  }
  response.redirect('/users');
});

module.exports = router;
