const express = require('express');
const router = express.Router({ mergeParams: true });
const Device = require('../models/device');
const Interface = require('../models/interface');
const middleware = require('../middleware');
const pagination = require('../services/pagination');
const parser = require('../middleware/parser/parser');

const TRUE_WORDS = ['yes', 'true', '1', 'on'];

/**
 * Coerces one submitted form value according to its catalog entry.
 * Returns undefined when the value should not be written.
 */
function coerceField(entry, raw) {
  if (raw === undefined) return undefined;
  const text = typeof raw === 'string' ? raw.trim() : raw;
  switch (entry.kind) {
    case 'number': {
      if (text === '' || text === null) return null;
      const number = Number(text);
      return Number.isFinite(number) ? number : undefined;
    }
    case 'boolean':
      return TRUE_WORDS.includes(String(text).toLowerCase());
    case 'select':
      return entry.options.includes(String(text)) ? String(text) : undefined;
    case 'date': {
      if (text === '' || text === null) return null;
      const date = new Date(text);
      return Number.isNaN(date.getTime()) ? undefined : date;
    }
    case 'json':
      return undefined; // read-only
    default:
      return text === null ? '' : String(text);
  }
}

/** applies every editable catalog field present in the form to the document */
function applyFormToInterface(doc, form) {
  for (const entry of Interface.fieldCatalog) {
    if (entry.readOnly) continue;
    const value = coerceField(entry, form[entry.name]);
    if (value !== undefined) doc.set(entry.name, value);
  }
}

/** copies the owning device's descriptive fields onto the interface */
function applyDeviceToInterface(doc, device) {
  doc.device = { id: device._id, hostname: device.hostname, ipaddress: device.ipaddress };
  doc.hostname = device.hostname;
  doc.ipaddress = device.ipaddress;
  doc.pop = device.pop || (device.popName && device.popName.name) || '';
  doc.devType = device.type || '';
  doc.devVendor = device.vendor || '';
  doc.devModel = device.model || '';
  doc.devPOP = device.pop || '';
  doc.devPOPLongName = device.popLongName || '';
  doc.devCabinet = device.cabinet || '';
  doc.devCty = device.cty || (device.county && device.county.name) || '';
  doc.devDistrict = device.district || '';
  doc.devSector = (device.sector && device.sector.name) || '';
  doc.devPOPType = device.popType || '';
  doc.btMSANCode = device.btMSANCode || '';
  doc.btMngIP = device.btMngIP || '';
  doc.btSector = device.btSector || '';
  doc.btDistrict = device.btDistrict || '';
}

/** recomputes the derived speed texts / category from the stored speeds */
function refreshSpeedTexts(doc) {
  Object.assign(
    doc,
    parser.parseSpeed({
      ifSpeed: doc.ifSpeed || doc.speed || 0,
      ifHighSpeed: doc.ifHighSpeed || 0,
      sp_speed: doc.sp_speed || 0,
      actualspeed: doc.actualspeed || 0,
    })
  );
}

// bootstrap-table server-side pagination: GET /interfaces/pagination?limit&offset&search&sort&order
const CATALOG_NAMES = Interface.fieldCatalog.map((entry) => entry.name);
const interfacePaginationSpec = {
  Model: Interface,
  searchFields: [
    'ifName',
    'ifAlias',
    'ifDescr',
    'ifTypeStr',
    'hostname',
    'ipaddress',
    'pop',
    'type',
    'specialService',
    'secondHost',
    'secondPOP',
    'secondInterface',
    'label',
    'connectionType',
    'linkType',
    'speedCat',
    'sp_provider',
    'sp_customer',
    'sp_service',
    'sp_linkNumber',
    'sp_CID',
  ],
  sortable: Object.fromEntries(CATALOG_NAMES.map((name) => [name, name])),
  defaultSort: 'hostname',
  // every catalog field plus the legacy names the list still shows
  projection: Object.fromEntries(
    [
      ...CATALOG_NAMES,
      'name',
      'alias',
      'index',
      'description',
      'author.email',
      'lastUpdatedBy.email',
      'created',
      'updated',
      'device.hostname',
      'device.ipaddress',
    ].map((name) => [name, 1])
  ),
  mapRow: function (intf) {
    const row = { _id: String(intf._id) };
    for (const name of CATALOG_NAMES) {
      row[name] = name === 'counters' ? JSON.stringify(intf.counters || {}) : intf[name];
    }
    // legacy fallbacks for documents created before the canonical names existed
    row.ifName = row.ifName || intf.name;
    row.ifAlias = row.ifAlias || intf.alias;
    row.ifIndex = row.ifIndex === undefined || row.ifIndex === null ? intf.index : row.ifIndex;
    row.ifDescr = row.ifDescr || intf.description;
    row.hostname = row.hostname || (intf.device && intf.device.hostname);
    row.ipaddress = row.ipaddress || (intf.device && intf.device.ipaddress);
    row.createdAt = row.createdAt || intf.created;
    row.lastUpdate = row.lastUpdate || intf.updated;
    row.createdBy = intf.author && intf.author.email;
    row.updatedBy = intf.lastUpdatedBy && intf.lastUpdatedBy.email;
    return row;
  },
};
router.get('/pagination', middleware.isLoggedIn, async function (request, response) {
  response.json(await pagination.paginatedResponse(request.query, interfacePaginationSpec));
});

//INDEX - the interface list is loaded by the table from /interfaces/pagination
router.get('/', middleware.isLoggedIn, function (request, response) {
  response.render('interfaces/index', { fields: Interface.fieldCatalog });
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
  const newInterface = new Interface();
  applyFormToInterface(newInterface, anInterface);
  // legacy input names of the form / API
  for (const [legacy, canonical] of [
    ['name', 'ifName'],
    ['alias', 'ifAlias'],
    ['index', 'ifIndex'],
    ['description', 'ifDescr'],
    ['speed', 'ifSpeed'],
  ]) {
    if (anInterface[legacy] !== undefined && anInterface[canonical] === undefined) {
      const value = coerceField(
        { kind: ['index', 'speed'].includes(legacy) ? 'number' : 'text' },
        anInterface[legacy]
      );
      if (value !== undefined) newInterface.set(canonical, value);
    }
  }
  applyDeviceToInterface(newInterface, foundDevice);
  newInterface.author = { id: request.user._id, email: request.user.email };
  newInterface.applyParsedAlias();
  let createdInterface;
  try {
    createdInterface = await newInterface.save();
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
  response.render('interfaces/edit', { interface: foundInterface, fields: Interface.fieldCatalog });
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
      fields: Interface.fieldCatalog,
    });
  } else {
    request.flash('error', "can't find interface!!!");
    response.redirect(request.get('Referrer') || '/');
  }
});
//UPDATE INTERFACE ROUTE
router.put('/:id', middleware.isLoggedIn, async function (request, response) {
  //find and update the correct DEVICE

  let foundInterface;
  try {
    foundInterface = await Interface.findById(request.params.id);
  } catch (error) {
    console.log(error);
    request.flash('error', 'something went wrong while updating the interface');
    return response.redirect('/devices/');
  }
  const form = request.body.interface;
  // legacy input names (name/alias/description/speed) map onto the canonical ones
  for (const [legacy, canonical] of [
    ['name', 'ifName'],
    ['alias', 'ifAlias'],
    ['description', 'ifDescr'],
    ['speed', 'ifSpeed'],
  ]) {
    if (form[legacy] !== undefined && form[canonical] === undefined) form[canonical] = form[legacy];
  }
  applyFormToInterface(foundInterface, form);
  // the international details only apply to international links
  if (!foundInterface.linkType || foundInterface.linkType.toLowerCase() !== 'international') {
    for (const field of ['provider', 'service', 'linkID', 'subCable', 'teCID', 'termination']) {
      foundInterface.set(field, undefined);
    }
  }
  // a changed alias is re-parsed (sp_* fields, special service, label)
  if (foundInterface.isModified('ifAlias') || foundInterface.isModified('alias')) {
    foundInterface.applyParsedAlias();
  } else {
    refreshSpeedTexts(foundInterface);
  }

  foundInterface.updated = new Date();
  foundInterface.lastUpdate = foundInterface.updated;
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
