/**
 * Numbers and recent activity for the home page dashboard (views/home.ejs).
 * Everything is a count or a small aggregation; nothing is cached because
 * the page is only rendered on demand.
 */
const Device = require('../models/device');
const Interface = require('../models/interface');
const Link = require('../models/link');
const POP = require('../models/pop');
const Cabinet = require('../models/cabinet');
const DeviceModel = require('../models/devicemodel');
const BTMSANInfo = require('../models/btmsaninfo');
const User = require('../models/user');
const AuditLog = require('../models/auditlog');
const Enrichment = require('../models/enrichment');
const syncRunner = require('./syncRunner');
const importDevices = require('./importDevices');
const snmpProfile = require('./snmpProfile');
const config = require('../config');

const TOP = 8;

/** top-N grouping of active devices by a field */
async function groupBy(field) {
  const rows = await Device.aggregate([
    { $match: Device.activeFilter() },
    { $group: { _id: { $ifNull: ['$' + field, ''] }, count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1 } },
    { $limit: TOP },
  ]);
  return rows.map((row) => ({
    value: row._id === '' || row._id === null ? '(blank)' : row._id,
    count: row.count,
  }));
}

async function counts() {
  const active = Device.activeFilter();
  const slowAfter = config.snmp.slowAfterTimeouts;
  const slowFilter = Device.activeFilter({
    $or: [{ snmpSlow: true }].concat(slowAfter > 0 ? [{ snmpTimeouts: { $gte: slowAfter } }] : []),
  });
  const [
    devices,
    decommissioned,
    discovered,
    neverSynced,
    slow,
    withErrors,
    interfaces,
    flagged,
    links,
    pops,
    cabinets,
    devicemodels,
    btmsaninfos,
    users,
    enrichments,
  ] = await Promise.all([
    Device.countDocuments(active),
    Device.countDocuments({ decommissioned: true }),
    Device.countDocuments(Device.activeFilter({ discovered: true })),
    Device.countDocuments(Device.activeFilter({ lastSyncTime: { $exists: false } })),
    Device.countDocuments(slowFilter),
    Device.countDocuments(Device.activeFilter({ lastSyncError: { $nin: [null, ''] } })),
    Interface.countDocuments({}),
    Interface.countDocuments({ delete: true }),
    Link.countDocuments({}),
    POP.countDocuments({}),
    Cabinet.countDocuments({}),
    DeviceModel.countDocuments({}),
    BTMSANInfo.countDocuments({}),
    User.countDocuments({}),
    Enrichment.countDocuments({}),
  ]);
  return {
    devices,
    decommissioned,
    discovered,
    neverSynced,
    slow,
    withErrors,
    interfaces,
    flagged,
    links,
    pops,
    cabinets,
    devicemodels,
    btmsaninfos,
    users,
    enrichments,
  };
}

async function summary() {
  const [totals, byVendor, byType, byCty, recentAudit, recentlySynced] = await Promise.all([
    counts(),
    groupBy('vendor'),
    groupBy('type'),
    groupBy('cty'),
    AuditLog.find({}, { action: 1, at: 1, 'user.email': 1, target: 1, 'details.reason': 1 })
      .sort({ at: -1 })
      .limit(TOP)
      .lean(),
    Device.find(Device.activeFilter({ lastSyncTime: { $exists: true } }), {
      hostname: 1,
      lastSyncTime: 1,
      lastSyncError: 1,
      snmpTimeouts: 1,
      snmpSlow: 1,
      vendor: 1,
    })
      .sort({ lastSyncTime: -1 })
      .limit(TOP)
      .lean(),
  ]);
  return {
    totals,
    byVendor,
    byType,
    byCty,
    recentAudit,
    recentlySynced: recentlySynced.map((device) => ({
      ...device,
      snmpProfile: snmpProfile.isKnownSlow(device) ? 'slow' : 'default',
    })),
    sync: syncRunner.status(),
    importStatus: importDevices.status(),
    slowAfterTimeouts: config.snmp.slowAfterTimeouts,
  };
}

module.exports = { summary, counts, groupBy };
