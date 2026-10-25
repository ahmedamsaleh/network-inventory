const express = require('express');
const audit = require('../services/audit');
const router = express.Router({ mergeParams: true });
const Device = require('../models/device');
const Interface = require('../models/interface');
const middleware = require('../middleware');
const pagination = require('../services/pagination');
const datasets = require('../services/datasets');
const parser = require('../middleware/parser/parser');
const logger = require('../middleware/logger');

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

/**
 * Applies every editable catalog field present in the form to the document.
 * Returns the validation messages for values that could not be coerced
 * (non-numeric numbers, unknown select options, unparsable dates); those
 * fields are left untouched.
 */
function applyFormToInterface(doc, form) {
  const errors = [];
  for (const entry of Interface.fieldCatalog) {
    if (entry.readOnly) continue;
    const raw = form[entry.name];
    const value = coerceField(entry, raw);
    if (value !== undefined) {
      doc.set(entry.name, value);
    } else if (
      raw !== undefined &&
      String(raw).trim() !== '' &&
      entry.kind !== 'json' &&
      entry.kind !== 'select' // unknown options are ignored (legacy clients send free text)
    ) {
      errors.push(
        entry.label +
          ': ' +
          (entry.kind === 'number'
            ? 'must be a number'
            : entry.kind === 'date'
              ? 'must be a date (YYYY-MM-DD or ISO date-time)'
              : 'invalid value')
      );
    }
  }
  if (form.ifIndex !== undefined && String(form.ifIndex).trim() !== '') {
    const index = Number(form.ifIndex);
    if (Number.isFinite(index) && (index < 0 || !Number.isInteger(index)))
      errors.push('ifIndex: must be a non-negative integer');
  }
  return errors;
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
router.get('/pagination', middleware.isLoggedIn, async function (request, response) {
  response.json(await pagination.paginatedResponse(request.query, datasets.interfaces));
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
  // legacy input names of the form / API map onto the canonical ones
  for (const [legacy, canonical] of [
    ['name', 'ifName'],
    ['alias', 'ifAlias'],
    ['index', 'ifIndex'],
    ['description', 'ifDescr'],
    ['speed', 'ifSpeed'],
  ]) {
    if (anInterface[legacy] !== undefined && anInterface[canonical] === undefined) {
      anInterface[canonical] = anInterface[legacy];
    }
  }
  //create new interface (linked to the device) with the current user as author
  const newInterface = new Interface();
  const formErrors = applyFormToInterface(newInterface, anInterface);
  if (!newInterface.ifName || !String(newInterface.ifName).trim()) {
    formErrors.unshift('ifName is required');
  }
  if (formErrors.length) {
    request.flash('error', formErrors.join('. '));
    return response.redirect('/interfaces/new?device=' + foundDevice._id);
  }
  newInterface.applyDevice(foundDevice);
  newInterface.author = { id: request.user._id, email: request.user.email };
  newInterface.applyParsedAlias();
  let createdInterface;
  try {
    createdInterface = await newInterface.save();
  } catch (error) {
    request.flash('error', middleware.describeError(error));
    return response.redirect('/interfaces/new?device=' + foundDevice._id);
  }
  logger.info('interface ' + createdInterface.ifName + ' added by ' + request.user.email);
  //connect new interface to device (atomic push: a full save() would re-run the
  //hostname/ip uniqueness validators against the device itself)
  await Device.findByIdAndUpdate(foundDevice._id, { $push: { interfaces: createdInterface } });
  //redirect device show page
  request.flash('success', 'Successfully added Interface');
  response.redirect('/devices/' + foundDevice._id);
});

//SHOW INTERFACE ROUTE - every catalog field, grouped (views/interfaces/show.ejs)
router.get('/:id', middleware.isLoggedIn, async function (request, response) {
  const foundInterface = await middleware.findByIdOr404(
    Interface,
    request.params.id,
    response,
    'Interface',
    '/interfaces'
  );
  if (!foundInterface) return;
  const device = await Device.findOne(
    {
      hostname:
        foundInterface.hostname || (foundInterface.device && foundInterface.device.hostname),
    },
    { _id: 1, hostname: 1, decommissioned: 1 }
  ).lean();
  response.render('interfaces/show', {
    interface: foundInterface,
    owner: device,
    fields: Interface.fieldCatalog,
  });
});

//DESTROY Interface ROUTE
router.delete('/:id', middleware.isLoggedIn, async function (request, response) {
  if (request.params.id == -1) {
    request.flash('error', 'Please select an interface first');
    return response.redirect(request.get('Referrer') || '/interfaces');
  }
  let foundInterface = null;
  try {
    foundInterface = await Interface.findById(request.params.id);
  } catch (error) {
    if (error.name !== 'CastError') throw error;
  }
  if (!foundInterface) {
    request.flash('error', 'Interface not found');
    return response.redirect(request.get('Referrer') || '/interfaces');
  }
  const device = foundInterface.device && foundInterface.device.hostname;

  try {
    // the audit entry (with a snapshot) is written before the document is removed
    await audit.recordDeletion(request, 'interface', foundInterface, { hostname: device });
    await Interface.deleteOne({ _id: foundInterface._id });
  } catch (error) {
    logger.error('interface delete failed (nothing removed): ' + error.message);
    request.flash('error', 'Delete failed (nothing was removed): ' + error.message);
    return response.redirect(request.get('Referrer') || '/');
  }

  // keep the embedded copy on the containing device in sync
  try {
    const foundDevice = await Device.findOne({ hostname: foundInterface.device.hostname });
    for (let i = 0; i < foundDevice.interfaces.length; i++) {
      if (foundDevice.interfaces[i].index == foundInterface.index) {
        //remove interface from the device
        foundDevice.interfaces.splice(i, 1);
        try {
          await Device.updateOne({ _id: foundDevice._id }, foundDevice);
        } catch (error) {
          logger.error('interface delete: embedded copy not updated: ' + error.message);
        }
        break;
      }
    }
  } catch {
    request.flash('warning', "Can't find the containing device");
  }
  request.flash('success', 'Interface deleted (the audit log keeps the last copy)');
  // the referrer may be the page of the deleted interface itself
  const referrer = request.get('Referrer') || '';
  if (referrer.indexOf('/interfaces/' + foundInterface._id) !== -1) {
    return response.redirect('/interfaces');
  }
  response.redirect(referrer || '/interfaces');
});

//EDIT INTERFACE ROUTE
router.get('/:id/edit', middleware.isLoggedIn, async function (request, response) {
  const foundInterface = await middleware.findByIdOr404(
    Interface,
    request.params.id,
    response,
    'Interface',
    '/interfaces'
  );
  if (!foundInterface) return;
  response.render('interfaces/edit', {
    interface: foundInterface,
    device: foundInterface.device,
    fields: Interface.fieldCatalog,
  });
});
//UPDATE INTERFACE ROUTE
router.put('/:id', middleware.isLoggedIn, async function (request, response) {
  //find and update the correct DEVICE

  const foundInterface = await middleware.findByIdOr404(
    Interface,
    request.params.id,
    response,
    'Interface',
    '/interfaces'
  );
  if (!foundInterface) return;
  const form = request.body.interface || {};
  // legacy input names (name/alias/description/speed) map onto the canonical ones
  for (const [legacy, canonical] of [
    ['name', 'ifName'],
    ['alias', 'ifAlias'],
    ['description', 'ifDescr'],
    ['speed', 'ifSpeed'],
  ]) {
    if (form[legacy] !== undefined && form[canonical] === undefined) form[canonical] = form[legacy];
  }
  const formErrors = applyFormToInterface(foundInterface, form);
  if (form.ifName !== undefined && String(form.ifName).trim() === '') {
    formErrors.unshift('ifName is required');
  }
  if (formErrors.length) {
    request.flash('error', formErrors.join('. '));
    return response.redirect('/interfaces/' + foundInterface._id + '/edit');
  }
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
    request.flash('error', middleware.describeError(error));
    return response.redirect('/interfaces/' + foundInterface._id + '/edit');
  }
  // keep the embedded copy on the containing device in sync
  try {
    const foundDevice = await Device.findOne({ hostname: foundInterface.device.hostname });
    for (let i = 0; i < foundDevice.interfaces.length; i++) {
      if (foundDevice.interfaces[i].index == foundInterface.index) {
        foundDevice.interfaces[i] = foundInterface;
        try {
          await Device.updateOne({ _id: foundDevice._id }, foundDevice);
        } catch (error) {
          logger.error('interface update: embedded copy not updated: ' + error.message);
        }
        break;
      }
    }
  } catch {
    request.flash('warning', "Can't find the containing device");
  }
  request.flash('success', 'Interface updated');
  response.redirect('/interfaces/' + foundInterface._id);
});
module.exports = router;
