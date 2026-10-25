const Device = require('../models/device'),
  Interface = require('../models/interface');
//all the middleware goes here
const middlewareObj = {};

middlewareObj.checkDeviceOwnership = async function (request, response, next) {
  if (request.isAuthenticated()) {
    let foundDevice;
    try {
      foundDevice = await Device.findById(request.params.id);
    } catch (err) {
      request.flash('error', 'Device not found');
      return response.redirect(request.get('Referrer') || '/');
    }
    // does user own the device?
    if (foundDevice.author.id.equals(request.user._id)) {
      next();
    } else {
      request.flash('error', "You don't have permission to do that");
      response.redirect(request.get('Referrer') || '/');
    }
  } else {
    request.flash('error', 'You need to be logged in to do that');
    response.redirect(request.get('Referrer') || '/');
  }
};

middlewareObj.checkInterfaceOwnership = async function (request, response, next) {
  if (request.isAuthenticated()) {
    let foundInterface;
    try {
      foundInterface = await Interface.findById(request.params.id);
    } catch (err) {
      request.flash('error', 'Interface not found');
      return response.redirect(request.get('Referrer') || '/');
    }
    // does user own the device?
    console.log(foundInterface);
    let foundDevice;
    try {
      foundDevice = await Device.findById(foundInterface.device.id);
    } catch (error) {
      request.flash('error', "The device that's containing the interface was not found!!!");
      return response.redirect(request.get('Referrer') || '/');
    }
    if (foundDevice.author.id.equals(request.user._id)) {
      next();
    } else {
      request.flash('error', "You don't have permission to do that");
      response.redirect(request.get('Referrer') || '/');
    }
  } else {
    request.flash('error', 'You need to be logged in to do that');
    response.redirect(request.get('Referrer') || '/');
  }
};

/**
 * Looks a document up by id and answers 404 (views/not-found.ejs) when the id
 * is malformed or nothing matches. Resolves with the document, or with null
 * after the response has been sent, so callers just `return` on null.
 */
middlewareObj.findByIdOr404 = async function (Model, id, response, label, backUrl) {
  let document = null;
  try {
    document = await Model.findById(id);
  } catch (error) {
    if (error.name !== 'CastError') {
      throw error;
    }
  }
  if (!document) {
    response.status(404).render('not-found', {
      message: label + ' "' + id + '" does not exist',
      backUrl: backUrl,
    });
  }
  return document;
};

/** user-facing text for a Mongoose validation / duplicate-key error */
middlewareObj.describeError = function (error) {
  if (error && error.code === 11000) return 'An entry with the same unique value already exists';
  if (error && error.errors) {
    return Object.values(error.errors)
      .map((detail) => detail.message)
      .join(', ');
  }
  return error && error.message ? error.message : 'Something went wrong';
};

middlewareObj.isLoggedIn = function (request, response, next) {
  // return next();//hack
  if (request.isAuthenticated()) {
    return next();
  }
  request.flash('error', 'You need to be logged in to do that');
  response.redirect('/login');
};

/** true when the logged-in user has the admin role (ValidatedUser role at signup) */
middlewareObj.isAdminUser = function (user) {
  return Boolean(user && user.role === 'admin');
};

/** isLoggedIn + the admin role; others are sent back with a message */
middlewareObj.isAdmin = function (request, response, next) {
  if (!request.isAuthenticated()) {
    request.flash('error', 'You need to be logged in to do that');
    return response.redirect('/login');
  }
  if (middlewareObj.isAdminUser(request.user)) {
    return next();
  }
  request.flash('error', 'Administrator rights are required to do that');
  response.redirect(request.get('Referrer') || '/devices');
};

module.exports = middlewareObj;
