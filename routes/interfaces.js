const express = require('express');
const router = express.Router({ mergeParams: true });
const Device = require('../models/device');
const Interface = require('../models/interface');
const middleware = require('../middleware');
const logger = require('../middleware/logger');

//INDEX - show all interfaces
router.get('/', middleware.isLoggedIn, async function (request, response) {
  let foundInterfaces;
  try {
    foundInterfaces = await Interface.find({});
  } catch (err) {
    logger.error(err);
    return;
  }
  response.render('interfaces/index', { interfaces: foundInterfaces });
  // response.send("VIEW Interfaces");
});

//Add Route for NEW interface linked with device
//NEW ROUTE for new interface
router.get('/new', middleware.isLoggedIn, async function (request, response) {
  let foundDevice;
  try {
    foundDevice = await Device.findById(request.params.id);
  } catch (error) {
    console.log('add new interface error: ' + error);
    return response.redirect('/devices');
  }
  response.render('interfaces/new', { device: foundDevice });
});

//CREATE ROUTE for new interface
router.post('/', middleware.isLoggedIn, async function (request, response) {
  // console.log(request);
  //lookup device using ID
  let foundDevice;
  try {
    foundDevice = await Device.findById(request.params.id);
  } catch (error) {
    console.log(error);
    request.flash('error', 'Something went wrong');
    return response.redirect('/devices');
  }
  //create new interface
  const anInterface = request.body.interface;

  let createdInterface;
  try {
    createdInterface = await Interface.create(anInterface);
  } catch (error) {
    console.log(error);
    return;
  }
  //add user and id to interface
  createdInterface.author.email = request.user.email;
  createdInterface.author.id = request.user._id;
  //save interface
  await createdInterface.save();
  console.log('interface from user- ' + request.user.username + ' is: ' + createdInterface);
  //connect new interface to device
  foundDevice.interfaces.push(createdInterface);
  await foundDevice.save();
  //redirect device show page
  request.flash('success', 'Successfully added Interface');
  response.redirect('/devices/' + foundDevice._id);
});

router.get('/:id', async function (request, response) {
  let foundInterface;
  try {
    foundInterface = await Interface.findById(request.params.id);
  } catch (error) {
    console.log(error);
    return;
  }
  response.render('interfaces/edit', { interface: foundInterface });
});

//DESTROY Interface ROUTE
router.delete('/:id', middleware.isLoggedIn, async function (request, response) {
  let foundInterface;
  try {
    foundInterface = await Interface.findById(request.params.id);
  } catch (error) {
    console.log(error);
    request.flash('error', 'something went wrong while updating the interface');
    return response.redirect(request.get('Referrer') || '/');
  }
  const device = foundInterface.device.hostname;
  console.log(device);

  try {
    await Interface.findByIdAndDelete(request.params.id);
  } catch (error) {
    console.log(error);
  }

  // keep the embedded copy on the containing device in sync
  try {
    const foundDevice = await Device.findOne({ hostname: foundInterface.device.hostname });
    for (let i = 0; i < foundDevice.interfaces.length; i++) {
      if (foundDevice.interfaces[i].index == foundInterface.index) {
        //remove interface from the device
        foundDevice.interfaces.splice(i, 1);
        console.log(foundDevice.interfaces);
        try {
          await Device.updateOne({ _id: foundDevice._id }, foundDevice);
        } catch (error) {
          console.log(error);
        }
        break;
      }
    }
  } catch (error) {
    request.flash('error', "Can't find containing device");
    console.log("Can't find containing device");
  }
  response.redirect(request.get('Referrer') || '/');
});

//EDIT INTERFACE ROUTE
router.get('/:id/edit', middleware.isLoggedIn, async function (request, response) {
  //is user logged in?
  console.log('Update an interface');
  // response.redirect("/devices/");
  let foundInterface;
  try {
    foundInterface = await Interface.findById(request.params.id);
  } catch (error) {
    console.log(error);
    request.flash('error', 'error found while searching for interface!!!');
    return response.redirect(request.get('Referrer') || '/');
  }
  if (foundInterface) {
    response.render('interfaces/edit', {
      interface: foundInterface,
      device: foundInterface.device,
    });
  } else {
    request.flash('error', "can't find interface!!!");
    response.redirect(request.get('Referrer') || '/');
  }
});
//UPDATE INTERFACE ROUTE
router.put('/:id', middleware.isLoggedIn, async function (request, response) {
  //find and update the correct DEVICE
  request.body.interface.updated = new Date();
  request.body.interface.lastUpdatedBy = { id: request.user._id, email: request.user.email };

  let foundInterface;
  try {
    foundInterface = await Interface.findById(request.params.id);
  } catch (error) {
    console.log(error);
    request.flash('error', 'something went wrong while updating the interface');
    return response.redirect('/devices/');
  }
  foundInterface.name = request.body.interface.name;
  foundInterface.alias = request.body.interface.alias;
  foundInterface.description = request.body.interface.description;
  foundInterface.type = request.body.interface.type;
  foundInterface.actualspeed = request.body.interface.actualspeed;
  if (
    request.body.interface.isDeviceUpLink &&
    request.body.interface.isDeviceUpLink.toLowerCase() == 'yes'
  ) {
    foundInterface.isDeviceUpLink = true;
  } else {
    foundInterface.isDeviceUpLink = false;
  }
  foundInterface.secondHost = request.body.interface.secondHost;
  foundInterface.secondPOP = request.body.interface.secondPOP;
  foundInterface.connectionType = request.body.interface.connectionType;
  if (
    request.body.interface.isPOPUpLink &&
    request.body.interface.isPOPUpLink.toLowerCase() == 'yes'
  ) {
    foundInterface.isPOPUpLink = true;
  } else {
    foundInterface.isPOPUpLink = false;
  }
  foundInterface.linkBandwidth = request.body.interface.linkBandwidth;
  foundInterface.linkIP = request.body.interface.linkIP;
  foundInterface.linkNumber = request.body.interface.linkNumber;
  foundInterface.linkType = request.body.interface.linkType;
  if (foundInterface.linkType && foundInterface.linkType.toLowerCase() == 'international') {
    foundInterface.provider = request.body.interface.provider;
    foundInterface.service = request.body.interface.service;
    foundInterface.linkID = request.body.interface.linkID;
    foundInterface.subCable = request.body.interface.subCable;
    foundInterface.teCID = request.body.interface.teCID;
    foundInterface.termination = request.body.interface.termination;
  }

  foundInterface.updated = new Date();
  foundInterface.lastUpdatedBy = { id: request.user._id, email: request.user.email };

  try {
    await foundInterface.save();
  } catch (error) {
    console.log(error);
  }
  // keep the embedded copy on the containing device in sync
  try {
    const foundDevice = await Device.findOne({ hostname: foundInterface.device.hostname });
    for (let i = 0; i < foundDevice.interfaces.length; i++) {
      if (foundDevice.interfaces[i].index == foundInterface.index) {
        foundDevice.interfaces[i] = foundInterface;
        console.log(foundDevice.interfaces[i]);
        try {
          await Device.updateOne({ _id: foundDevice._id }, foundDevice);
        } catch (error) {
          console.log(error);
        }
        break;
      }
    }
  } catch (error) {
    request.flash('error', "Can't find containing device");
    console.log("Can't find containing device");
  }
  response.redirect('/devices/');
});
module.exports = router;
