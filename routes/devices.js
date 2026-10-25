const express = require('express');
const router = express.Router();
const Device = require('../models/device');
const POP = require('../models/pop');
const Sector = require('../models/sector');
const County = require('../models/county');
const middleware = require('../middleware');
const pagination = require('../services/pagination');
const datasets = require('../services/datasets');
const syncRunner = require('../services/syncRunner');
const popData = require('../services/popData');
const deviceModels = require('../services/deviceModels');
const decommission = require('../services/decommission');
const snmpProfile = require('../services/snmpProfile');
const Interface = require('../models/interface');
const ArchivedInterface = require('../models/archivedInterface');
const Link = require('../models/link');
const Cabinet = require('../models/cabinet');
const DeviceModel = require('../models/devicemodel');
const BTMSANInfo = require('../models/btmsaninfo');
const Address4 = require('ip-address').Address4;

const DEVICE_TYPES = DeviceModel.DEVICE_TYPES;

function isIPv4(value) {
  try {
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(value) && new Address4(value).isValid();
  } catch {
    return false;
  }
}

/**
 * Form-level validation shared by create and update (the model validators
 * run as well; this gives one readable message per problem before hitting
 * the database). Returns the list of messages (empty = ok).
 */
function validateDeviceForm(form, fields, { creating } = {}) {
  const errors = [];
  if (creating) {
    const hostname = String(form.hostname || '').trim();
    const ipaddress = String(form.ipaddress || '').trim();
    if (hostname.length < 5) errors.push('Hostname must be at least 5 characters');
    else if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(hostname))
      errors.push('Hostname may only contain letters, digits, dots, dashes and underscores');
    if (!isIPv4(ipaddress)) errors.push('IP address must be a valid IPv4 address');
  }
  if (fields.btMngIP && !isIPv4(fields.btMngIP))
    errors.push('BT management IP must be a valid IPv4 address (or left blank)');
  if (fields.community !== undefined && fields.community === '')
    errors.push('SNMP community cannot be blank');
  return errors;
}
const config = require('../config');
const seedDB = require('../seeds');
const mongoose = require('mongoose');
const logger = require('../middleware/logger');

/**
 * Reads the free-text device fields of a submitted form (see
 * Device.editableTextFields): every value is trimmed; empty values fall back
 * to the schema default when the field has one, otherwise they are left out
 * on create / cleared on update. `community` also accepts the legacy
 * `communityString` input name and is mirrored into `communityString`.
 */
function deviceFieldsFromForm(form, { forUpdate } = {}) {
  const fields = {};
  for (const name of Device.editableTextFields) {
    let raw = form[name];
    if (name === 'community' && (raw === undefined || raw === '')) {
      raw = form.communityString;
    }
    let value = typeof raw === 'string' ? raw.trim() : raw;
    if (value === '' || value === undefined || value === null) {
      const schemaDefault = Device.schema.path(name).defaultValue;
      value =
        schemaDefault !== undefined
          ? schemaDefault
          : forUpdate && raw !== undefined
            ? ''
            : undefined;
    }
    if (value !== undefined) {
      fields[name] = value;
    }
  }
  if (fields.community !== undefined) {
    fields.communityString = fields.community;
  }
  return fields;
}

// bootstrap-table server-side pagination: GET /devices/pagination?limit&offset&search&sort&order
router.get('/pagination', middleware.isLoggedIn, async function (request, response) {
  response.json(await pagination.paginatedResponse(request.query, datasets.devices));
});

//INDEX - the device list is loaded by the table from /devices/pagination
router.get('/', middleware.isLoggedIn, function (request, response) {
  response.render('devices/index');
});

//CREATE - add new device to DB
router.post('/', middleware.isLoggedIn, async function (request, response) {
  //get data from a form and add to devices array
  const hostname = request.body.device.hostname;
  const ipaddress = request.body.device.ipaddress;
  const textFields = deviceFieldsFromForm(request.body.device);
  const formErrors = validateDeviceForm(request.body.device, textFields, { creating: true });
  if (formErrors.length) {
    request.flash('error', formErrors.join('. '));
    return response.redirect('/devices/new');
  }
  const form = request.body.device;
  // the pickers submit ids; the legacy "NONE" value means "the document named NONE"
  const pickedId = async (Model, value) => {
    const text = value === undefined || value === null ? '' : String(value).trim();
    if (text === 'NONE') {
      const none = await Model.findOne({ name: 'NONE' }).lean();
      return none ? String(none._id) : undefined;
    }
    return text || undefined;
  };
  const popId = await pickedId(POP, form.popName && form.popName.name);
  const sectorId = await pickedId(Sector, form.sector && form.sector.name);
  const countyId = await pickedId(County, form.county && form.county.name);
  // the pickers submit ids; anything else is a form problem, not a crash
  const backToForm = (message) => {
    request.flash('error', message);
    return response.redirect('/devices/new');
  };
  if (popId === undefined || !mongoose.isValidObjectId(popId)) {
    return backToForm('Please choose the POP from the list');
  }
  if (sectorId === undefined || !mongoose.isValidObjectId(sectorId)) {
    return backToForm('Please choose the sector from the list');
  }
  if (countyId === undefined || !mongoose.isValidObjectId(countyId)) {
    return backToForm('Please choose the county from the list');
  }
  const [foundPOP, foundSector, foundCty] = await Promise.all([
    POP.findById(popId),
    Sector.findById(sectorId),
    County.findById(countyId),
  ]);
  if (!foundPOP) return backToForm('The chosen POP does not exist (any more)');
  if (!foundSector) return backToForm('The chosen sector does not exist (any more)');
  if (!foundCty) return backToForm('The chosen county does not exist (any more)');
  ///here goes correct values
  const aDevice = Object.assign({}, textFields, {
    hostname: hostname.trim(),
    ipaddress: ipaddress.trim(),
    author: { id: request.user._id, email: request.user.email },
    popName: foundPOP,
    sector: foundSector,
    county: foundCty,
  });
  aDevice.interfaces = [];
  // a known cabinet decides the device's POP (and brings the POP's data along)
  await popData.resolvePopFromCabinet(aDevice);
  // blank vendor/type are filled from the model catalogue
  await deviceModels.applyDeviceModel(aDevice);
  logger.info('Device discovery started');
  let device;
  try {
    device = await Device.create(aDevice);
  } catch (error) {
    logger.log(error.errors);
    for (const field in error.errors) {
      request.flash('error', error.errors[field].message);
    }
    return response.redirect('/devices/new'); // back to the form
  }
  logger.info('new device created and saved');
  request.flash('success', 'Successfully added device, will start device discovery now');
  syncRunner.start([device]); // background discovery (services/syncDevice), reports its own errors
  response.redirect('/devices'); //will redirect as a GET request
});

//NEW - show form to create new device
//should show the form will post data to /devices
router.get('/new', middleware.isLoggedIn, function (request, response) {
  if (config.seed) {
    seedDB(request.user);
  }
  response.render('devices/new', { types: DEVICE_TYPES });
});

// /devices/hostname/<hostname> -> the device page (used by the interface lists)
router.get('/hostname/:hostname', middleware.isLoggedIn, async function (request, response) {
  const hostname = String(request.params.hostname || '').trim();
  const found = hostname ? await Device.findOne({ hostname: hostname }, { _id: 1 }).lean() : null;
  if (!found) {
    return response.status(404).render('not-found', {
      message: 'Device "' + hostname + '" does not exist',
      backUrl: '/devices',
    });
  }
  response.redirect('/devices/' + found._id);
});

//Sync devices (services/syncRunner: bounded concurrency, per-device results)
router.get('/sync', middleware.isLoggedIn, async function (request, response) {
  if (syncRunner.isRunning()) {
    request.flash('warning', 'A synchronisation run is already in progress');
  } else {
    const devices = await Device.find(Device.activeFilter()); // decommissioned devices are skipped
    syncRunner.start(devices); // runs in the background
    request.flash('success', 'Synchronising ' + devices.length + ' devices in the background');
  }
  response.redirect('/devices');
});
// JSON status of the current / last synchronisation run
router.get('/sync/status', middleware.isLoggedIn, function (request, response) {
  response.json(syncRunner.status());
});
router.get('/sync/:id', middleware.isLoggedIn, async function (request, response) {
  logger.info('syncing one device: ' + request.params.id);
  const foundDevice = await middleware.findByIdOr404(
    Device,
    request.params.id,
    response,
    'Device',
    '/devices'
  );
  if (!foundDevice) return;
  if (foundDevice.decommissioned) {
    request.flash('error', foundDevice.hostname + ' is decommissioned and is not synchronised');
  } else if (syncRunner.isRunning()) {
    request.flash('warning', 'A synchronisation run is already in progress');
  } else {
    // IIB may pass a (placeholder) community in the URL: ?community=...
    const community =
      typeof request.query.community === 'string' ? request.query.community.trim() : '';
    syncRunner.start([foundDevice], community ? { community } : {}); // runs in the background
    request.flash('success', 'Synchronising ' + foundDevice.hostname + ' in the background');
  }
  response.redirect('/devices');
});

//DECOMMISSIONED DEVICES - list (restore / permanent delete are admin actions)
router.get('/decommissioned', middleware.isLoggedIn, function (request, response) {
  response.render('devices/decommissioned');
});
router.get('/decommissioned/pagination', middleware.isLoggedIn, async function (request, response) {
  const query = Object.assign({ order: 'desc' }, request.query);
  response.json(await pagination.paginatedResponse(query, datasets.decommissionedDevices));
});

//SHOW DEVICE ROUTE
router.get('/:id', middleware.isLoggedIn, async function (request, response) {
  const foundDevice = await middleware.findByIdOr404(
    Device,
    request.params.id,
    response,
    'Device',
    '/devices'
  );
  if (!foundDevice) return;
  // related records shown next to the device
  const [cabinet, deviceModel, btInfo, pop, linkCount, interfaceCount, archivedCount] =
    await Promise.all([
      Cabinet.findByName(foundDevice.cabinet),
      DeviceModel.findByName(foundDevice.model),
      BTMSANInfo.findByCode(foundDevice.btMSANCode).then(
        (info) => info || BTMSANInfo.findByMngIP(foundDevice.btMngIP || foundDevice.ipaddress)
      ),
      foundDevice.popName && foundDevice.popName.id
        ? POP.findById(foundDevice.popName.id).lean()
        : POP.findOne({ shortName: foundDevice.pop }).lean(),
      Link.countDocuments({
        $or: [{ device1: foundDevice.hostname }, { device2: foundDevice.hostname }],
      }),
      Interface.countDocuments(decommission.liveInterfaceFilter(foundDevice)),
      foundDevice.decommissioned
        ? ArchivedInterface.countDocuments({ 'archive.deviceId': foundDevice._id })
        : Promise.resolve(0),
    ]);
  response.render('devices/show', {
    device: foundDevice,
    snmpProfile: snmpProfile.slowReason(foundDevice),
    related: { cabinet, deviceModel, btInfo, pop, linkCount, interfaceCount, archivedCount },
    fields: Interface.fieldCatalog,
  });
});

//DECOMMISSION - confirmation step, then the soft delete (any logged-in user)
router.get('/:id/decommission', middleware.isLoggedIn, async function (request, response) {
  if (request.params.id == -1) {
    // list button without a selected row
    request.flash('error', 'Please select a device first');
    return response.redirect('/devices');
  }
  const foundDevice = await middleware.findByIdOr404(
    Device,
    request.params.id,
    response,
    'Device',
    '/devices'
  );
  if (!foundDevice) return;
  if (foundDevice.decommissioned) {
    request.flash('warning', foundDevice.hostname + ' is already decommissioned');
    return response.redirect('/devices/' + foundDevice._id);
  }
  response.render('devices/decommission', {
    device: foundDevice,
    summary: await decommission.summarize(foundDevice),
  });
});
router.post('/:id/decommission', middleware.isLoggedIn, async function (request, response) {
  const foundDevice = await middleware.findByIdOr404(
    Device,
    request.params.id,
    response,
    'Device',
    '/devices'
  );
  if (!foundDevice) return;
  const form = request.body || {};
  if (form.confirm !== 'yes') {
    request.flash('error', 'Please confirm the decommissioning of ' + foundDevice.hostname);
    return response.redirect('/devices/' + foundDevice._id + '/decommission');
  }
  const reason = typeof form.reason === 'string' ? form.reason.trim() : '';
  try {
    const result = await decommission.decommissionDevice(foundDevice, {
      user: request.user,
      reason,
      ip: request.ip,
    });
    request.flash(
      'success',
      foundDevice.hostname +
        ' decommissioned (' +
        result.archived +
        ' interface(s) archived); an administrator can restore it from the decommissioned list'
    );
  } catch (error) {
    logger.error('decommission of ' + foundDevice.hostname + ' failed: ' + error.message);
    request.flash('error', 'Decommissioning failed: ' + error.message);
    return response.redirect('/devices/' + foundDevice._id);
  }
  response.redirect('/devices');
});

//RESTORE (undo decommissioning) - admin only, with a confirmation step
router.get('/:id/restore', middleware.isAdmin, async function (request, response) {
  if (request.params.id == -1) {
    request.flash('error', 'Please select a device first');
    return response.redirect('/devices/decommissioned');
  }
  const foundDevice = await middleware.findByIdOr404(
    Device,
    request.params.id,
    response,
    'Device',
    '/devices/decommissioned'
  );
  if (!foundDevice) return;
  if (!foundDevice.decommissioned) {
    request.flash('warning', foundDevice.hostname + ' is not decommissioned');
    return response.redirect('/devices/' + foundDevice._id);
  }
  response.render('devices/restore', {
    device: foundDevice,
    summary: await decommission.summarize(foundDevice),
  });
});
router.post('/:id/restore', middleware.isAdmin, async function (request, response) {
  const foundDevice = await middleware.findByIdOr404(
    Device,
    request.params.id,
    response,
    'Device',
    '/devices/decommissioned'
  );
  if (!foundDevice) return;
  if ((request.body || {}).confirm !== 'yes') {
    request.flash('error', 'Please confirm the restore of ' + foundDevice.hostname);
    return response.redirect('/devices/' + foundDevice._id + '/restore');
  }
  try {
    const result = await decommission.restoreDevice(foundDevice, {
      user: request.user,
      ip: request.ip,
    });
    request.flash(
      'success',
      foundDevice.hostname + ' restored (' + result.restored + ' interface(s) back in service)'
    );
  } catch (error) {
    logger.error('restore of ' + foundDevice.hostname + ' failed: ' + error.message);
    request.flash('error', 'Restore failed: ' + error.message);
  }
  response.redirect('/devices/' + foundDevice._id);
});

//EDIT DEVICE ROUTE
router.get('/:id/edit', middleware.isLoggedIn, async function (request, response) {
  //is user logged in?
  logger.info('Update a device');
  const foundDevice = await middleware.findByIdOr404(
    Device,
    request.params.id,
    response,
    'Device',
    '/devices'
  );
  if (!foundDevice) return;
  response.render('devices/edit', { device: foundDevice, types: DEVICE_TYPES });
});
//UPDATE DEVICE ROUTE
router.put('/:id', middleware.isLoggedIn, async function (request, response) {
  //find and update the correct DEVICE
  const form = request.body.device || {};
  const updates = deviceFieldsFromForm(form, { forUpdate: true });
  const formErrors = validateDeviceForm(form, updates, { creating: false });
  if (formErrors.length) {
    request.flash('error', formErrors.join('. '));
    return response.redirect('/devices/' + request.params.id + '/edit');
  }
  updates.updatedAt = new Date();
  updates.lastUpdatedBy = { id: request.user._id, email: request.user.email };
  if (form.sector && form.sector.name !== undefined) {
    // the picker submits the sector id; a plain name is accepted as well
    const sectorValue = String(form.sector.name).trim();
    if (mongoose.isValidObjectId(sectorValue)) {
      const foundSector = await Sector.findById(sectorValue).lean();
      updates.sector = foundSector
        ? { id: foundSector._id, name: foundSector.name }
        : { name: sectorValue };
    } else {
      updates.sector = { name: sectorValue };
    }
  }
  if (form.snmpSlow !== undefined) {
    updates.snmpSlow = ['true', 'on', '1', 'yes'].includes(String(form.snmpSlow).toLowerCase());
  }
  // note: Select2 has a defect which removes pop name and replace it with the id
  if (
    !form.popName ||
    !mongoose.isValidObjectId(form.popName.name) ||
    !form.county ||
    !mongoose.isValidObjectId(form.county.name)
  ) {
    request.flash('error', 'Please choose the POP and the county from the lists');
    return response.redirect('/devices/' + request.params.id + '/edit');
  }
  const popObjectId = new mongoose.Types.ObjectId(form.popName.name);
  const ctyObjectId = new mongoose.Types.ObjectId(form.county.name);
  let foundPOP;
  try {
    foundPOP = await POP.findById({ _id: popObjectId });
  } catch (error) {
    logger.error(error);
    return response.redirect('/devices/' + request.params.id);
  }
  updates.popName = Object.assign({}, form.popName, { name: foundPOP.name });
  let foundCty;
  try {
    foundCty = await County.findById({ _id: ctyObjectId });
  } catch (error) {
    logger.error(error);
    return response.redirect('/devices/' + request.params.id);
  }
  updates.county = Object.assign({}, form.county, { name: foundCty.name });
  try {
    if (updates.cabinet !== undefined) {
      // a known cabinet decides the device's POP (and brings the POP's data along)
      const resolved = await popData.resolvePopFromCabinet({ cabinet: updates.cabinet });
      for (const [key, value] of Object.entries(resolved)) {
        if (key === 'sector.name')
          updates.sector = Object.assign({}, updates.sector, { name: value });
        else if (key === 'popName.name')
          updates.popName = Object.assign({}, updates.popName, { name: value });
        else updates[key] = value;
      }
    }
    await Device.findByIdAndUpdate(request.params.id, updates);
  } catch (error) {
    logger.error(error);
    return response.redirect('/devices');
  }
  //redirect somewhere (show page)
  response.redirect('/devices/' + request.params.id);
});
//DESTROY Device ROUTE - permanent removal (admin only); the audit entry with a
//full snapshot is written before anything is deleted (services/decommission)
router.delete('/:id', middleware.isAdmin, async function (request, response) {
  logger.warn('Deleting device with id: ' + request.params.id);
  if (request.params.id == -1) {
    request.flash('error', 'Please select a device first');
    return response.redirect('/devices');
  }
  const foundDevice = await middleware.findByIdOr404(
    Device,
    request.params.id,
    response,
    'Device',
    '/devices'
  );
  if (!foundDevice) return;
  try {
    const result = await decommission.deleteDevicePermanently(foundDevice, { request });
    request.flash(
      'success',
      foundDevice.hostname +
        ' deleted permanently (' +
        (result.interfaces + result.archived) +
        ' interface(s) removed); the audit log keeps the last copy'
    );
  } catch (error) {
    logger.error('delete of ' + foundDevice.hostname + ' failed: ' + error.message);
    request.flash('error', 'Delete failed (nothing was removed): ' + error.message);
    return response.redirect('/devices/' + foundDevice._id);
  }
  response.redirect(foundDevice.decommissioned ? '/devices/decommissioned' : '/devices');
});

module.exports = router;
