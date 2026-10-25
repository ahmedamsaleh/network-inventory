/**
 * Default vendor behaviour: no workarounds. Vendor modules override the
 * hooks they need; every hook must be pure and must not throw.
 *
 *   matches({ device, sys })            -> boolean (sysObjectID / sysDescr / device.vendor)
 *   community(device, defaultCommunity) -> community string to use
 *   sessionOptions(device)              -> extra session options (timeoutMs, retries, ...)
 *   normalizeRows(rows, ctx)            -> rows (fix values the device reports wrongly)
 *   filterRows(rows, ctx)               -> rows (drop rows the inventory must ignore)
 */
module.exports = {
  name: 'generic',
  enterpriseOids: [],
  keywords: [],
  matches() {
    return false;
  },
  community(device, defaultCommunity) {
    return device.community || device.communityString || defaultCommunity;
  },
  /** extra net-snmp session options for this device ({ timeoutMs, retries, ... }) */
  sessionOptions() {
    return {};
  },
  normalizeRows(rows) {
    return rows;
  },
  filterRows(rows) {
    return rows;
  },
};
