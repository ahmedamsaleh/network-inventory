const express = require('express');
const router = express.Router({ mergeParams: true });
const User = require('../models/user');
const middleware = require('../middleware');

//INDEX - show all Users
router.get('/', middleware.isLoggedIn, async function (request, response) {
  let foundUsers;
  try {
    foundUsers = await User.find({});
  } catch (error) {
    console.log(error);
    return;
  }
  response.render('users/index', { users: foundUsers });
});

//DESTROY USER ROUTE
router.delete('/:id', async function (request, response) {
  if (request.params.id == -1) {
    response.redirect('/users');
  }
  console.log('Deleting User with id: ' + request.params.id);
  try {
    await User.findByIdAndDelete(request.params.id);
  } catch (error) {
    console.log(error);
  }
  response.redirect('/users');
});

module.exports = router;
