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

middlewareObj.isLoggedIn = function (request, response, next) {
  // return next();//hack
  if (request.isAuthenticated()) {
    return next();
  }
  request.flash('error', 'You need to be logged in to do that');
  response.redirect('/login');
};

module.exports = middlewareObj;
