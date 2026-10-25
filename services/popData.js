/**
 * Resolves the POP a device belongs to and copies the POP data onto it.
 *
 * Resolution order:
 *   1. the device's cabinet (models/cabinet.js) when it names a POP,
 *   2. the first segment of the hostname (ONGAR in ONGAR-R39J-D-IR),
 *   3. the device's own `pop` value.
 */
const POP = require('../models/pop');
const Cabinet = require('../models/cabinet');

const UNSET = new Set(['', 'Unknown', 'Unkown']);

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isSet(value) {
  return value !== undefined && value !== null && !UNSET.has(String(value).trim());
}

async function findPopByShortName(shortName) {
  if (!isSet(shortName)) return null;
  return POP.findOne({
    shortName: new RegExp('^' + escapeRegExp(String(shortName).trim()) + '$', 'i'),
  }).lean();
}

/** the cabinet record of a device (its `cabinet` field, else the hostname prefix) */
async function findDeviceCabinet(device) {
  const names = [device.cabinet, Cabinet.cabinetOfHostname(device.hostname)].filter(isSet);
  for (const name of names) {
    const cabinet = await Cabinet.findByName(name);
    if (cabinet) return cabinet;
  }
  return null;
}

/** the POP of a device: cabinet's POP, then hostname prefix, then device.pop */
async function findDevicePop(device) {
  const cabinet = await findDeviceCabinet(device);
  const candidates = [
    cabinet && cabinet.pop,
    Cabinet.cabinetOfHostname(device.hostname),
    device.pop,
  ];
  for (const candidate of candidates) {
    const pop = await findPopByShortName(candidate);
    if (pop) return pop;
  }
  return null;
}

/**
 * Copies pop / popLongName / cty / district / sector / popType of the POP onto
 * the device (in memory, so interfaces inherit them through applyDevice())
 * and returns the fields to persist on the device.
 */
function applyPopToDevice(device, pop) {
  const fields = {
    pop: pop.shortName,
    popLongName: pop.popLongName,
    cty: pop.cty,
    district: pop.district,
    popType: pop.popType,
  };
  Object.assign(device, fields);
  const popName = (device.popName && device.popName.name) || pop.name || pop.shortName;
  if (typeof device.set === 'function') {
    device.set('sector.name', pop.sector);
    device.set('popName.name', popName);
  } else {
    device.sector = { ...(device.sector || {}), name: pop.sector };
    device.popName = { ...(device.popName || {}), name: popName };
  }
  fields['sector.name'] = pop.sector;
  fields['popName.name'] = popName;
  return fields;
}

/**
 * Device form helper: when a cabinet is set and known, the device's POP (and
 * the POP's data) come from the cabinet. Returns the fields to persist, or
 * an empty object when nothing could be resolved.
 */
async function resolvePopFromCabinet(device) {
  if (!isSet(device.cabinet)) return {};
  const cabinet = await Cabinet.findByName(device.cabinet);
  if (!cabinet || !isSet(cabinet.pop)) return {};
  const pop = await findPopByShortName(cabinet.pop);
  if (pop) return applyPopToDevice(device, pop);
  device.pop = cabinet.pop;
  return { pop: cabinet.pop };
}

module.exports = {
  findPopByShortName,
  findDeviceCabinet,
  findDevicePop,
  applyPopToDevice,
  resolvePopFromCabinet,
};
