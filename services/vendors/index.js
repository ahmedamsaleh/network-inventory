/**
 * Vendor workaround registry. detect() picks the module from the device's
 * sysObjectID (enterprise prefix), then from the vendor code of the hostname
 * naming rule (<POP>-<TYPE><NN><VENDOR>-...), then sysDescr / device.vendor
 * keywords.
 *
 * community() applies the IIB rule: a community equal to one of the
 * configured placeholders (COMMUNITY_KEYn) is swapped for the real string
 * (COMMUNITY_VALUEn) right before the session is opened; the placeholder is
 * what stays in the database and in the logs.
 */
const config = require('../../config');
const parser = require('../../middleware/parser/parser');
const generic = require('./generic');
const huawei = require('./huawei');
const zte = require('./zte');
const alcatelsiemens = require('./alcatelsiemens');
const juniper = require('./juniper');

const VENDORS = [huawei, zte, alcatelsiemens, juniper];

function detect(device, sys) {
  const sysObjectID = String((sys && sys.sysObjectID) || '');
  for (const vendor of VENDORS) {
    if (
      vendor.enterpriseOids.some((oid) => sysObjectID === oid || sysObjectID.startsWith(oid + '.'))
    ) {
      return vendor;
    }
  }
  const details = parser.parseHostname(device && device.hostname);
  const text = [
    sys && sys.sysDescr,
    device && device.vendor,
    device && device.model,
    details && details.deviceVendor,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  for (const vendor of VENDORS) {
    if (vendor.keywords.some((keyword) => text.includes(keyword))) return vendor;
  }
  return generic;
}

/** the community to open the session with (IIB placeholder swapped for the real string) */
function community(device, defaultCommunity, override) {
  const requested = override || generic.community(device, defaultCommunity);
  const aliases = config.snmp.communityAliases || {};
  return Object.prototype.hasOwnProperty.call(aliases, requested) ? aliases[requested] : requested;
}

/** merged session options of every vendor hook that applies to the device */
function sessionOptions(device) {
  let options = {};
  for (const vendor of VENDORS) {
    options = { ...options, ...vendor.sessionOptions(device) };
  }
  return options;
}

module.exports = {
  VENDORS,
  generic,
  huawei,
  zte,
  alcatelsiemens,
  juniper,
  detect,
  community,
  sessionOptions,
};
