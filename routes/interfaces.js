const express = require('express');
const router = express.Router({ mergeParams: true });
const Device = require('../models/device');
const Interface = require('../models/interface');
const middleware = require('../middleware');
const pagination = require('../services/pagination');

// bootstrap-table server-side pagination: GET /interfaces/pagination?limit&offset&search&sort&order
const interfacePaginationSpec = {
  Model: Interface,
  searchFields: [
    'name',
    'alias',
    'description',
    'type',
    'device.hostname',
    'device.ipaddress',
    'secondHost',
    'secondPOP',
    'connectionType',
    'linkType',
  ],
  sortable: {
    index: 'index',
    name: 'name',
    device: 'device.hostname',
    alias: 'alias',
    type: 'type',
    speed: 'speed',
    adminStatus: 'adminStatus',
    operStatus: 'operStatus',
    actualspeed: 'actualspeed',
    isDeviceUpLink: 'isDeviceUpLink',
    delete: 'delete',
    created: 'created',
    updated: 'updated',
  },
  defaultSort: 'device',
  // only what views/interfaces/index.ejs displays
  projection: {
    index: 1,
    name: 1,
    'device.hostname': 1,
    alias: 1,
    description: 1,
    type: 1,
    speed: 1,
    adminStatus: 1,
    operStatus: 1,
    actualspeed: 1,
    isDeviceUpLink: 1,
    delete: 1,
    'author.email': 1,
    'lastUpdatedBy.email': 1,
    created: 1,
    updated: 1,
  },
  mapRow: function (intf) {
    return {
      _id: String(intf._id),
      index: intf.index,
      name: intf.name,
      device: intf.device && intf.device.hostname,
      alias: intf.alias,
      description: intf.description,
      type: intf.type,
      speed: intf.speed,
      adminStatus: intf.adminStatus,
      operStatus: intf.operStatus,
      actualspeed: intf.actualspeed,
      isDeviceUpLink: intf.isDeviceUpLink,
      delete: intf.delete,
      createdBy: intf.author && intf.author.email,
      updatedBy: intf.lastUpdatedBy && intf.lastUpdatedBy.email,
      created: intf.created,
      updated: intf.updated,
    };
  },
};
router.get('/pagination', middleware.isLoggedIn, async function (request, response) {
  response.json(await pagination.paginatedResponse(request.query, interfacePaginationSpec));
});

//INDEX - the interface list is loaded by the table from /interfaces/pagination
router.get('/', middleware.isLoggedIn, function (request, response) {
  response.render('interfaces/index');
});

// the router is mounted at /interfaces, so the owning device is identified by
// ?device=<id> (new form) or the form's hidden interface[device][id] (create)
//NEW ROUTE for new interface
router.get('/new', middleware.isLoggedIn, async function (request, response) {
  const deviceId = request.query.device || request.params.id;
  if (!deviceId) {
    request.flash('error', 'Choose the device the interface belongs to');
    return response.redirect('/devices');
  }
  const foundDevice = await middleware.findByIdOr404(
    Device,
    deviceId,
    response,
    'Device',
    '/devices'
  );
  if (!foundDevice) return;
  response.render('interfaces/new', { device: foundDevice });
});

//CREATE ROUTE for new interface
router.post('/', middleware.isLoggedIn, async function (request, response) {
  //lookup device using ID
  const anInterface = request.body.interface || {};
  const deviceId = (anInterface.device && anInterface.device.id) || request.params.id;
  let foundDevice = null;
  try {
    foundDevice = deviceId ? await Device.findById(deviceId) : null;
  } catch (error) {
    if (error.name !== 'CastError') throw error;
  }
  if (!foundDevice) {
    request.flash('error', 'Cannot add the interface: device not found');
    return response.redirect('/devices');
  }
  //create new interface (linked to the device) with the current user as author
  anInterface.device = {
    id: foundDevice._id,
    hostname: foundDevice.hostname,
    ipaddress: foundDevice.ipaddress,
  };
  anInterface.author = { id: request.user._id, email: request.user.email };
  let createdInterface;
  try {
    createdInterface = await Interface.create(anInterface);
  } catch (error) {
    console.log(error);
    request.flash('error', 'Something went wrong: ' + error.message);
    return response.redirect('/devices/' + foundDevice._id);
  }
  console.log('interface from user- ' + request.user.email + ' is: ' + createdInterface);
  //connect new interface to device (atomic push: a full save() would re-run the
  //hostname/ip uniqueness validators against the device itself)
  await Device.findByIdAndUpdate(foundDevice._id, { $push: { interfaces: createdInterface } });
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
