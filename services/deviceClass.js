/**
 * Device classification used by the sync.
 *
 * A device counts as:
 *   - GPON  when the hostname type code is G (<POP>-<TYPE><NN><VENDOR>-...),
 *   - MSAN  when its stored type is MSAN, or it is an Alcatel device whose
 *           hostname matches -M\d\dN- (forced to MSAN),
 *   - otherwise its stored type, else the type from the hostname code.
 */
const parser = require('../middleware/parser/parser');

const ACCESS_CLASSES = new Set(['MSAN', 'GPON', 'DSLAM', 'CONTROLLER', 'DPI']);
const PARENT_POP_PARTNERS = new Set(['MSAN', 'GPON', 'ROUTER']);
const ALCATEL_MSAN_HOSTNAME = /-M\d\dN-/i;

function isAlcatel(device) {
  const vendor = String((device && device.vendor) || '').toLowerCase();
  if (vendor.includes('alcatel')) return true;
  const details = parser.parseHostname(device && device.hostname);
  return Boolean(details && String(details.deviceVendor || '').toLowerCase() === 'alcatel');
}

/** true when the Alcatel "-MnnN-" hostname rule forces the MSAN type */
function isForcedMsan(device) {
  return ALCATEL_MSAN_HOSTNAME.test(String((device && device.hostname) || '')) && isAlcatel(device);
}

/** @returns {string} 'GPON' | 'MSAN' | 'Router' | ... | '' */
function classifyDevice(device) {
  if (!device) return '';
  const stored = String(device.type || '').trim();
  const details = parser.parseHostname(device.hostname);
  const fromHostname = details && details.deviceType ? String(details.deviceType) : '';
  if (fromHostname.toUpperCase() === 'GPON') return 'GPON';
  if (stored.toUpperCase() === 'MSAN' || isForcedMsan(device)) return 'MSAN';
  if (stored && stored.toUpperCase() !== 'UNKNOWN' && stored.toUpperCase() !== 'UNKOWN')
    return stored;
  return fromHostname;
}

/** MSAN, GPON, DSLAM, controller and DPI devices */
function isAccessDevice(deviceClass) {
  return ACCESS_CLASSES.has(String(deviceClass || '').toUpperCase());
}

/** link partners whose POP becomes the parent POP of an MSAN/GPON interface */
function isParentPopPartner(deviceClass) {
  return PARENT_POP_PARTNERS.has(String(deviceClass || '').toUpperCase());
}

module.exports = { classifyDevice, isAccessDevice, isParentPopPartner, isForcedMsan, isAlcatel };
