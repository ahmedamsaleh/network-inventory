/**
 * Fills a device's vendor / type (and model name) from the DeviceModel
 * catalogue: by sysObjectID (authoritative, overrides) or by model name
 * (fills blanks only). Mutates the device in memory and returns the fields
 * to persist ({} when nothing matched).
 */
const DeviceModel = require('../models/devicemodel');

const BLANK = new Set(['', 'Unknown', 'Unkown']);

function isBlank(value) {
  return value === undefined || value === null || BLANK.has(String(value).trim());
}

async function applyDeviceModel(device, sysObjectID) {
  const match = await DeviceModel.resolve({ sysObjectID, model: device.model });
  if (!match) return {};
  const fields = {};
  const authoritative = match.matchedBy === 'sysObjectID';
  if (match.vendor && (authoritative || isBlank(device.vendor))) fields.vendor = match.vendor;
  if (match.type && (authoritative || isBlank(device.type))) fields.type = match.type;
  if (match.model && isBlank(device.model)) fields.model = match.model;
  Object.assign(device, fields);
  return fields;
}

module.exports = { applyDeviceModel, isBlank };
