/**
 * SNMP synchronisation of one device:
 *   1. read sysDescr / sysObjectID / sysName,
 *   2. walk ifTable + ifXTable and merge them into rows,
 *   3. store the unparsed rows in the rawinterface collection,
 *   4. apply the vendor workarounds (services/vendors), keep the interesting
 *      interfaces, parse their ifAlias (middleware/parser), enrich them with
 *      the device's POP / sector / county data and upsert them by
 *      (hostname, ifIndex) - no duplicates,
 *   5. flag interfaces that were not seen (syncCycles / delete) and update
 *      the device (sys*, embedded interfaces, lastSyncTime, deviceSyncCycles).
 *
 * syncDevice() never rejects: it resolves with a per-device result object.
 * The SNMP session factory is injectable for tests (options.createSession).
 */
const S = require('string');
const config = require('../config');
const logger = require('../middleware/logger');
const snmpSession = require('./snmpSession');
const vendors = require('./vendors');
const parser = require('../middleware/parser/parser');
const Device = require('../models/device');
const Interface = require('../models/interface');
const RawInterface = require('../models/rawinterface');
const Link = require('../models/link');
const popData = require('./popData');
const deviceModels = require('./deviceModels');
const deviceClass = require('./deviceClass');
const BTMSANInfo = require('../models/btmsaninfo');
const snmpProfile = require('./snmpProfile');

const OIDS = {
  sysDescr: '1.3.6.1.2.1.1.1.0',
  sysObjectID: '1.3.6.1.2.1.1.2.0',
  sysName: '1.3.6.1.2.1.1.5.0',
  ifTable: {
    oid: '1.3.6.1.2.1.2.2',
    columns: { ifIndex: 1, ifDescr: 2, ifType: 3, ifSpeed: 5, ifAdminStatus: 7, ifOperStatus: 8 },
  },
  ifXTable: {
    oid: '1.3.6.1.2.1.31.1.1',
    columns: { ifName: 1, ifHCInOctets: 6, ifHCOutOctets: 10, ifHighSpeed: 15, ifAlias: 18 },
  },
};
const STATUS_UP = 1;
const STATUS_NAMES = { 1: 'up', 2: 'down', 3: 'testing' };

const ALIAS_MARKERS = {
  startsWith: ['int-', 'esp-', 'nr_', 'reserved'],
  contains: ['bitstream', '_enb_', '-fw'],
};
const NAME_PREFIXES = [
  '100ge',
  'bundle-ether',
  'hundredgige',
  'ae',
  'at',
  'e1',
  'et',
  'fa',
  'fe-',
  'ge-',
  'gi',
  'po',
  'se',
  'so-',
  'te',
  'xe-',
];

/* -------------------------------------------------------------- helpers */

function text(value) {
  return value === undefined || value === null ? '' : String(snmpSession.toPlainValue(value));
}

/** numeric SNMP values; Counter64 arrives as an 8-byte big-endian Buffer */
function number(value) {
  if (value === undefined || value === null) return undefined;
  if (Buffer.isBuffer(value)) {
    if (value.length === 0) return 0;
    const padded = Buffer.concat([Buffer.alloc(Math.max(0, 8 - value.length)), value.subarray(-8)]);
    return Number(padded.readBigUInt64BE());
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** merges the two table walks into one row per ifIndex */
function mergeTables(ifTable, ifXTable) {
  const { columns: c1 } = OIDS.ifTable;
  const { columns: c2 } = OIDS.ifXTable;
  const rows = [];
  for (const rowKey of Object.keys(ifTable)) {
    const base = ifTable[rowKey] || {};
    const extra = (ifXTable && ifXTable[rowKey]) || {};
    rows.push({
      rowKey,
      ifIndex: base[c1.ifIndex] !== undefined ? number(base[c1.ifIndex]) : Number(rowKey),
      ifDescr: text(base[c1.ifDescr]),
      ifType: number(base[c1.ifType]),
      ifSpeed: number(base[c1.ifSpeed]),
      ifAdminStatus:
        base[c1.ifAdminStatus] !== undefined ? Number(base[c1.ifAdminStatus]) : undefined,
      ifOperStatus: number(base[c1.ifOperStatus]),
      ifName: text(extra[c2.ifName]),
      ifAlias: text(extra[c2.ifAlias]),
      ifHighSpeed: number(extra[c2.ifHighSpeed]),
      ifHCInOctets: number(extra[c2.ifHCInOctets]),
      ifHCOutOctets: number(extra[c2.ifHCOutOctets]),
    });
  }
  return rows;
}

/**
 * The inventory's interest rules (unchanged from the original discovery):
 * admin+oper up, not an MPLS interface, and either an alias that follows one
 * of the naming conventions or a physical-looking interface name.
 */
function isInterestingInterface(row) {
  if (row.ifAdminStatus !== STATUS_UP || row.ifOperStatus !== STATUS_UP) return false;
  if (S(row.ifDescr).toLowerCase().contains('mpls')) return false;
  const alias = S(row.ifAlias).toString().toLowerCase();
  if (
    ALIAS_MARKERS.startsWith.some((marker) => S(alias).startsWith(marker)) ||
    ALIAS_MARKERS.contains.some((marker) => S(alias).contains(marker))
  ) {
    return true;
  }
  const name = S(row.ifName).toString().toLowerCase();
  if (S(name).isEmpty() || S(name).contains('.') || S(name).contains(':')) return false;
  if (S(name).contains('/')) {
    const parts = S(name).splitLeft('/');
    if (
      parts.length >= 3 &&
      parts.slice(0, 3).every((part) => !S(part).isEmpty() && S(part).isNumeric())
    ) {
      return true;
    }
  }
  if (S(name).startsWith('galway')) return false;
  return NAME_PREFIXES.some((prefix) => S(name).startsWith(prefix));
}

async function readSystem(session) {
  const values = await session.get([OIDS.sysDescr, OIDS.sysObjectID, OIDS.sysName]);
  return {
    sysDescr: text(values[OIDS.sysDescr]),
    sysObjectID: text(values[OIDS.sysObjectID]),
    sysName: text(values[OIDS.sysName]),
  };
}

async function readInterfaceTables(session) {
  const ifTable = await session.tableColumns(OIDS.ifTable.oid, Object.values(OIDS.ifTable.columns));
  let ifXTable = {};
  try {
    ifXTable = await session.tableColumns(OIDS.ifXTable.oid, Object.values(OIDS.ifXTable.columns));
  } catch (error) {
    // devices without ifXTable still yield their ifTable
    logger.warn('ifXTable not readable (' + error.message + '), continuing with ifTable only');
  }
  return mergeTables(ifTable, ifXTable || {});
}

async function storeRawRows(device, rows, sys, vendorName, now) {
  if (rows.length === 0) return 0;
  const operations = rows.map((row) => ({
    updateOne: {
      // keyed by the OID row index (always unsigned); the reported ifIndex stays in `columns`
      filter: { hostname: device.hostname, ifIndex: Number(row.rowKey) || row.ifIndex },
      update: {
        $set: {
          ipaddress: device.ipaddress,
          deviceId: device._id,
          columns: row,
          sys,
          vendor: vendorName,
          collectedAt: now,
        },
      },
      upsert: true,
    },
  }));
  await RawInterface.bulkWrite(operations, { ordered: false });
  return rows.length;
}

/** link information (other end) for an interface, from the Link collection */
async function findLinkInfo(hostname, ifName) {
  if (!ifName) return null;
  const link = await Link.findOne({
    $or: [
      { device1: hostname, interface1: ifName },
      { device2: hostname, interface2: ifName },
    ],
  }).lean();
  return link ? parser.linkInfoFromLink(link, hostname) : null;
}

/** builds the $set document for one interesting row */
async function buildInterfaceUpdate(device, row, now, options = {}) {
  const doc = new Interface({
    ifName: row.ifName || row.ifDescr,
    ifAlias: row.ifAlias,
    ifIndex: row.ifIndex,
    ifDescr: row.ifDescr,
    ifType: row.ifType,
    ifSpeed: row.ifSpeed,
    ifHighSpeed: row.ifHighSpeed,
    ifHCInOctets: row.ifHCInOctets,
    ifHCOutOctets: row.ifHCOutOctets,
    adminStatus: STATUS_NAMES[row.ifAdminStatus] || text(row.ifAdminStatus),
    operStatus: STATUS_NAMES[row.ifOperStatus] || text(row.ifOperStatus),
  });
  doc.applyDevice(device);
  doc.applyParsedAlias(); // also mirrors the legacy field names
  const linkInfo = await findLinkInfo(device.hostname, doc.ifName);
  if (linkInfo) {
    doc.secondHost = linkInfo.secondHost;
    doc.secondInterface = linkInfo.secondInterface;
    doc.secondPOP = linkInfo.secondPOP;
    if (linkInfo.type) doc.type = linkInfo.type;
    if (!doc.label) doc.label = linkInfo.label;
    // the link partner's class (from its record / hostname) is always recorded
    const partner = await findLinkedDevice(linkInfo.secondHost);
    const partnerClass = deviceClass.classifyDevice(partner);
    doc.secondDeviceType = partnerClass;
    // interfaces on MSAN / GPON devices linked to an MSAN, GPON or Router take
    // the partner's POP (shortName_cty, cabinet lookup applied) as parent POP
    const ownClass = String(options.deviceClass || '').toUpperCase();
    if (
      (ownClass === 'MSAN' || ownClass === 'GPON') &&
      deviceClass.isParentPopPartner(partnerClass)
    ) {
      doc.parentPOP = await parentPopOf(partner);
      doc.secondPOP = doc.parentPOP;
    }
  }
  const plain = doc.toObject();
  // only SNMP-derived, parsed and device data is written on sync; flags and
  // fields edited by hand (isUpLink, apiFlag, linkType, ...) are left alone
  const SYNC_FIELDS = [
    'ifName',
    'ifAlias',
    'ifIndex',
    'ifDescr',
    'ifType',
    'ifTypeStr',
    'ifSpeed',
    'ifHighSpeed',
    'ifHCInOctets',
    'ifHCOutOctets',
    'adminStatus',
    'operStatus',
    'name',
    'alias',
    'index',
    'description',
    'speed',
    'specialService',
    'unknownFlag',
    'sp_speed',
    'sp_speedText',
    'ifSpeedText',
    'ifHighSpeedText',
    'actualspeedText',
    'speedCat',
    'label',
    'hostname',
    'ipaddress',
    'pop',
    'devType',
    'devVendor',
    'devModel',
    'devPOP',
    'devPOPLongName',
    'devCabinet',
    'devCty',
    'devDistrict',
    'devSector',
    'devPOPType',
    'btMSANCode',
    'btMngIP',
    'btSector',
    'btDistrict',
    'device',
    ...Interface.SP_TEXT_FIELDS.map((field) => 'sp_' + field),
  ];
  const update = {};
  for (const field of SYNC_FIELDS) {
    if (plain[field] !== undefined) update[field] = plain[field];
  }
  if (linkInfo) {
    update.secondHost = plain.secondHost;
    update.secondInterface = plain.secondInterface;
    update.secondPOP = plain.secondPOP;
    update.secondDeviceType = plain.secondDeviceType;
    if (plain.parentPOP) update.parentPOP = plain.parentPOP;
    if (linkInfo.type) update.type = plain.type;
  }
  update.counters = { ifHCInOctets: row.ifHCInOctets, ifHCOutOctets: row.ifHCOutOctets, at: now };
  update.lastSyncTime = now;
  update.syncCycles = 0;
  update.delete = false;
  update.updated = now;
  update.lastUpdate = now;
  return update;
}

async function upsertInterface(device, row, now, options = {}) {
  const update = await buildInterfaceUpdate(device, row, now, options);
  const result = await Interface.findOneAndUpdate(
    { hostname: device.hostname, ifIndex: row.ifIndex },
    {
      $set: update,
      $setOnInsert: {
        created: now,
        createdAt: now,
        author: {
          id: device.author && device.author.id,
          email: device.author && device.author.email,
        },
      },
    },
    { upsert: true, returnDocument: 'after', includeResultMetadata: true }
  );
  const created = !(result.lastErrorObject && result.lastErrorObject.updatedExisting);
  return { doc: result.value, created };
}

/** interfaces of the device that were not seen in this cycle */
async function flagMissingInterfaces(device, seenIndexes, threshold) {
  const filter = { hostname: device.hostname, ifIndex: { $nin: seenIndexes } };
  const missing = await Interface.countDocuments(filter);
  if (missing === 0) return { missing: 0, flagged: 0 };
  await Interface.updateMany(filter, { $inc: { syncCycles: 1 } });
  const flagged = await Interface.updateMany(
    { ...filter, syncCycles: { $gt: threshold } },
    { $set: { delete: true } }
  );
  return { missing, flagged: flagged.modifiedCount || 0 };
}

const UNKNOWN = 'Unknown';

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * BT MSAN reference data: matched by the device's SNMP management IP
 * (device.ipaddress == BTMSANInfo.mngIP). Nothing else is compared; when no
 * row matches every BT field becomes "Unknown" (hand-typed values included).
 */
async function applyBtMsanInfo(device) {
  const info = await BTMSANInfo.findByMngIP(device.ipaddress);
  const fields = {
    btMSANCode: info ? info.msanCode : UNKNOWN,
    btMngIP: info ? info.mngIP : UNKNOWN,
    btSector: info ? info.sector : UNKNOWN,
    btDistrict: info ? info.district : UNKNOWN,
  };
  Object.assign(device, fields);
  return fields;
}

/**
 * Device class for the sync rules (GPON from the hostname, MSAN from the
 * stored type or the Alcatel -MnnN- rule, ...). A forced MSAN / GPON is
 * persisted on the device type when the stored type does not say so.
 */
function applyDeviceClass(device) {
  const cls = deviceClass.classifyDevice(device);
  const fields = {};
  const stored = String(device.type || '').trim();
  if ((cls === 'MSAN' || cls === 'GPON') && stored.toUpperCase() !== cls) {
    fields.type = cls;
    device.type = cls;
  }
  return { cls, fields };
}

/**
 * Interfaces on MSAN, GPON, DSLAM, controller and DPI devices are kept only
 * when ifType is 6 (ethernet) or 117 (gigabitEthernet) and they show traffic.
 */
function isInterestingAccessInterface(row) {
  const type = Number(row.ifType);
  if (type !== 6 && type !== 117) return false;
  return (Number(row.ifHCInOctets) || 0) > 0 || (Number(row.ifHCOutOctets) || 0) > 0;
}

/** the Device document of a link partner (by hostname), or a stub for classification */
async function findLinkedDevice(hostname) {
  if (!hostname) return null;
  const found = await Device.findOne({
    hostname: new RegExp('^' + escapeRegExp(hostname) + '$', 'i'),
  }).lean();
  return found || { hostname };
}

/** shortName_cty of a device's POP (cabinet lookup applies), "Unknown" when none */
async function parentPopOf(device) {
  const pop = await popData.findDevicePop(device);
  return pop && pop.pop_cty ? pop.pop_cty : UNKNOWN;
}

/** consecutive timeouts are counted so the device can switch to the slow profile */
async function recordFailure(device, error) {
  if (!device || !device._id) return;
  const update = { $set: { lastSyncError: error.message } };
  if (snmpSession.isTimeoutError(error)) update.$inc = { snmpTimeouts: 1 };
  try {
    await Device.updateOne({ _id: device._id }, update);
  } catch (updateError) {
    logger.error('sync of ' + device.hostname + ': cannot record failure: ' + updateError.message);
  }
}

function resolveCommunity(device, override) {
  return vendors.community(device, config.snmp.defaultCommunity, override);
}

/**
 * @param {object} device   Device document (or plain object with the same fields)
 * @param {object} [options]
 * @param {function} [options.createSession] SNMP session factory (default services/snmpSession)
 * @param {string} [options.community]  community override (e.g. from the request), alias-swapped too
 * @param {Date} [options.now]
 * @param {number} [options.cyclesThreshold]
 * @returns {Promise<object>} per-device result, never rejects
 */
async function syncDevice(device, options = {}) {
  const createSession = options.createSession || snmpSession.createSession;
  const now = options.now || new Date();
  const threshold =
    options.cyclesThreshold !== undefined ? options.cyclesThreshold : config.sync.cyclesThreshold;
  const startedAt = Date.now();
  const result = {
    deviceId: device && device._id,
    hostname: device && device.hostname,
    ipaddress: device && device.ipaddress,
    ok: false,
    error: null,
    vendor: '',
    sys: {},
    interfaces: { total: 0, interesting: 0, created: 0, updated: 0, missing: 0, flagged: 0 },
    raw: 0,
    durationMs: 0,
    snmpProfile: 'default',
  };
  let session = null;
  try {
    if (!device || !device.hostname) throw new Error('sync: device without hostname');
    if (device.decommissioned) throw new Error('sync: device is decommissioned');
    let vendor = vendors.detect(device, {});
    // vendor options (e.g. the long timeouts of the special Juniper devices),
    // replaced by the short profile for devices known to be slow
    const profile = snmpProfile.sessionOptions(device, vendors.sessionOptions(device));
    result.snmpProfile = profile.profile;
    session = createSession({
      host: device.ipaddress,
      community: resolveCommunity(device, options.community),
      ...profile.options,
      onError: (error) =>
        logger.error('device ' + device.hostname + ' SNMP session error: ' + error),
    });
    if (!session || session.isNull) {
      throw (
        (session && session.error) ||
        new snmpSession.SnmpSessionError('no SNMP session', device.ipaddress)
      );
    }
    const sys = await readSystem(session);
    result.sys = sys;
    vendor = vendors.detect(device, sys);
    result.vendor = vendor.name;

    // vendor / type from the DeviceModel catalogue (sysObjectID, else model name)
    const modelFields = await deviceModels.applyDeviceModel(device, sys.sysObjectID);
    result.deviceModel = modelFields.vendor || modelFields.type ? { ...modelFields } : null;
    vendor = vendors.detect(device, sys);
    result.vendor = vendor.name;

    // device class (MSAN / GPON / ...) and BT MSAN reference data (by management IP)
    const { cls, fields: classFields } = applyDeviceClass(device);
    result.deviceClass = cls;
    const btFields = await applyBtMsanInfo(device);
    result.btMSANCode = btFields.btMSANCode;

    // POP data (imported "POPs" sheet) -> device -> interfaces
    const pop = await popData.findDevicePop(device);
    const popFields = pop ? popData.applyPopToDevice(device, pop) : {};
    result.pop = pop ? pop.shortName : null;

    const rawRows = await readInterfaceTables(session);
    result.interfaces.total = rawRows.length;
    result.raw = await storeRawRows(device, rawRows, sys, vendor.name, now);

    const context = { device, sys };
    const rows = vendor.filterRows(vendor.normalizeRows(rawRows, context), context);
    const interesting = rows.filter(
      deviceClass.isAccessDevice(cls) ? isInterestingAccessInterface : isInterestingInterface
    );
    result.interfaces.interesting = interesting.length;

    const embedded = [];
    const seen = [];
    for (const row of interesting) {
      const { doc, created } = await upsertInterface(device, row, now, { deviceClass: cls });
      result.interfaces[created ? 'created' : 'updated'] += 1;
      embedded.push(doc.toObject());
      seen.push(row.ifIndex);
    }
    Object.assign(result.interfaces, await flagMissingInterfaces(device, seen, threshold));

    await Device.updateOne(
      { _id: device._id },
      {
        $set: {
          ...modelFields,
          ...classFields,
          ...btFields,
          ...popFields,
          sysDescr: sys.sysDescr,
          sysObjectID: sys.sysObjectID,
          sysName: sys.sysName,
          interfaces: embedded,
          discovered: true,
          lastSyncTime: now,
          updatedAt: now,
          snmpTimeouts: 0, // responsive again: back to the default SNMP profile
          lastSyncError: '',
        },
        $inc: { deviceSyncCycles: 1 },
      }
    );
    result.ok = true;
  } catch (error) {
    result.error = error.message;
    result.errorName = error.name;
    logger.error('sync of ' + (device && device.hostname) + ' failed: ' + error.message);
    await recordFailure(device, error);
  } finally {
    if (session && typeof session.close === 'function') session.close();
    result.durationMs = Date.now() - startedAt;
  }
  return result;
}

module.exports = {
  OIDS,
  syncDevice,
  isInterestingInterface,
  mergeTables,
  readSystem,
  readInterfaceTables,
  buildInterfaceUpdate,
  isInterestingAccessInterface,
  applyBtMsanInfo,
  applyDeviceClass,
};
