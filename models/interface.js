const mongoose = require('mongoose');
const parser = require('../middleware/parser/parser');
const snmpLookups = require('../lookUps');

const UNKNOWN = 'Unknown';

/** reverse of lookUps.ifType: number -> IANA ifType name */
const IF_TYPE_NAMES = Object.fromEntries(
  Object.entries(snmpLookups.ifType).map(([name, number]) => [number, name])
);

/* sp_* fields: the special-service fields parsed from the alias (see
 * middleware/parser/parser.js parseIfAlias); "Unknown" until parsed */
const SP_TEXT_FIELDS = [
  'service',
  'provider',
  'termination',
  'bundleId',
  'linkNumber',
  'CID',
  'BTCID',
  'subCable',
  'customer',
  'sourceCore',
  'destinationCore',
  'vendor',
  'pop',
  'fwType',
  'serviceType',
  'ipType',
  'siteCode',
  'connType',
  'emsOrder',
  'connectedBW',
  'dpiName',
  'portID',
  'preNumber',
];

const spFields = {};
for (const field of SP_TEXT_FIELDS) {
  spFields['sp_' + field] = { type: String, default: UNKNOWN };
}
spFields.sp_speed = { type: Number, default: 0 };

//Database template setup
const interfaceSchema = new mongoose.Schema({
  // ---- SNMP identity (ifName/ifAlias/... are the canonical names; name/alias/
  // index/description/speed are the legacy names kept in sync by a hook) ----
  name: String,
  ifName: String,
  alias: String,
  ifAlias: String,
  index: Number,
  ifIndex: Number,
  description: String,
  ifDescr: String,
  ifType: Number, // IANA ifType number
  ifTypeStr: String, // its name, e.g. ethernet-csmacd
  speed: Number,
  ifSpeed: Number, // bit/s
  ifHighSpeed: Number, // Mbit/s
  ifHCInOctets: Number,
  ifHCOutOctets: Number,
  pollInterval: Number, // seconds
  counters: { type: mongoose.Schema.Types.Mixed, default: {} },
  adminStatus: String,
  operStatus: String,
  actualspeed: Number,
  // ---- link classification ----
  type: { type: String, default: '' }, // Local | WAN
  specialService: { type: String, default: '' }, // International | Cache | Bitstream | ...
  secondPOP: String,
  secondHost: String,
  secondInterface: String,
  secondDeviceType: String,
  secondPOPType: String,
  label: String,
  apiFlag: { type: Boolean, default: false },
  noEnrichmentFlag: { type: Boolean, default: false },
  unknownFlag: { type: Number, default: 0 },
  isUpLink: { type: String, default: '0' },
  // ---- speeds ----
  speedCat: { type: String, default: UNKNOWN },
  ifSpeedText: { type: String, default: UNKNOWN },
  ifHighSpeedText: { type: String, default: UNKNOWN },
  sp_speedText: { type: String, default: UNKNOWN },
  actualspeedText: { type: String, default: UNKNOWN },
  // ---- parsed special-service fields ----
  ...spFields,
  // ---- owning device (denormalized) ----
  hostname: String,
  ipaddress: String,
  pop: String,
  devType: String,
  devVendor: String,
  devModel: String,
  devPOP: String,
  devPOPLongName: String,
  devCabinet: String,
  devCty: String,
  devDistrict: String,
  devSector: String,
  devPOPType: String,
  btMSANCode: String,
  btMngIP: String,
  btSector: String,
  btDistrict: String,
  // ---- legacy enrichment fields ----
  delete: { type: Boolean, default: false }, //used to mark interface for deletion
  syncCycles: { type: Number, default: 0 }, //used to track number of sync cycles where interface was missed
  connectionType: String,
  isDeviceUpLink: { type: Boolean, default: false },
  isPOPUpLink: { type: Boolean, default: false },
  linkBandwidth: { type: Number, default: 0 },
  linkID: String,
  linkIP: String,
  linkNumber: String,
  linkType: { type: String, default: 'Normal' },
  provider: String,
  service: String,
  subCable: String,
  teCID: String,
  termination: String,
  // ---- timestamps ----
  created: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
  updated: Date,
  lastUpdate: Date,
  lastSyncTime: Date,
  device: {
    id: {
      type: mongoose.Schema.Types.ObjectId,
      //ref is the name of the model
      ref: 'Device',
    },
    hostname: String,
    ipaddress: String,
  },
  author: {
    id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    email: String,
  },
  lastUpdatedBy: {
    id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    email: String,
  },
});

/* legacy <-> canonical name pairs kept in sync on every save */
const MIRRORED = [
  ['name', 'ifName'],
  ['alias', 'ifAlias'],
  ['index', 'ifIndex'],
  ['description', 'ifDescr'],
  ['speed', 'ifSpeed'],
  ['created', 'createdAt'],
  ['updated', 'lastUpdate'],
  ['device.hostname', 'hostname'],
  ['device.ipaddress', 'ipaddress'],
];

function isSet(value) {
  return value !== undefined && value !== null && value !== '';
}

/** copies each mirrored pair towards the side that was not (or less recently) set */
function syncMirroredFields(doc) {
  for (const [legacy, canonical] of MIRRORED) {
    const legacyValue = doc.get(legacy);
    const canonicalValue = doc.get(canonical);
    if (doc.isModified(canonical) && isSet(canonicalValue)) {
      doc.set(legacy, canonicalValue);
    } else if (doc.isModified(legacy) && isSet(legacyValue)) {
      doc.set(canonical, legacyValue);
    } else if (isSet(canonicalValue) && !isSet(legacyValue)) {
      doc.set(legacy, canonicalValue);
    } else if (isSet(legacyValue) && !isSet(canonicalValue)) {
      doc.set(canonical, legacyValue);
    }
  }
  if (isSet(doc.ifType) && !isSet(doc.ifTypeStr)) {
    doc.ifTypeStr = IF_TYPE_NAMES[doc.ifType] || String(doc.ifType);
  }
}

interfaceSchema.pre('validate', function () {
  syncMirroredFields(this);
});

/**
 * Fills the parser-derived fields (sp_*, specialService, label, unknownFlag,
 * speed texts, speedCat) from the alias and the stored speeds. Pure data
 * transformation - call before save().
 */
interfaceSchema.methods.applyParsedAlias = function () {
  syncMirroredFields(this);
  const parsed = parser.parseIfAlias(this.ifAlias || this.alias);
  const known = parsed.pattern !== '' && parsed.unknownFlag === 0;
  for (const field of SP_TEXT_FIELDS) {
    this['sp_' + field] = known && isSet(parsed[field]) ? String(parsed[field]) : UNKNOWN;
  }
  this.sp_speed = known ? parsed.speed : 0;
  this.specialService = parsed.link.specialService;
  this.unknownFlag = parsed.unknownFlag;
  if (known && parsed.link.label) {
    this.label = parsed.link.label;
  }
  const speeds = parser.parseSpeed({
    ifSpeed: this.ifSpeed || this.speed || 0,
    ifHighSpeed: this.ifHighSpeed || 0,
    sp_speed: this.sp_speed,
    actualspeed: this.actualspeed || 0,
  });
  Object.assign(this, speeds);
  return this;
};

/**
 * Field catalog used by the edit form (views/interfaces/edit.ejs), the PUT
 * handler (input coercion) and the list (views/interfaces/index.ejs).
 * kind: text | number | boolean | flag01 | select | date | json
 */
const select = (options) => ({ kind: 'select', options });
interfaceSchema.statics.fieldCatalog = [
  // identity
  { name: 'ifName', label: 'ifName', kind: 'text', group: 'SNMP' },
  { name: 'ifAlias', label: 'ifAlias', kind: 'text', group: 'SNMP' },
  { name: 'ifIndex', label: 'ifIndex', kind: 'number', group: 'SNMP' },
  { name: 'ifDescr', label: 'ifDescr', kind: 'text', group: 'SNMP' },
  { name: 'ifType', label: 'ifType (number)', kind: 'number', group: 'SNMP' },
  { name: 'ifTypeStr', label: 'ifType (name)', kind: 'text', group: 'SNMP' },
  { name: 'ifSpeed', label: 'ifSpeed (bit/s)', kind: 'number', group: 'SNMP' },
  { name: 'ifHighSpeed', label: 'ifHighSpeed (Mbit/s)', kind: 'number', group: 'SNMP' },
  { name: 'ifHCInOctets', label: 'ifHCInOctets', kind: 'number', group: 'SNMP' },
  { name: 'ifHCOutOctets', label: 'ifHCOutOctets', kind: 'number', group: 'SNMP' },
  { name: 'pollInterval', label: 'Poll interval (s)', kind: 'number', group: 'SNMP' },
  { name: 'adminStatus', label: 'Admin status', kind: 'text', group: 'SNMP' },
  { name: 'operStatus', label: 'Oper status', kind: 'text', group: 'SNMP' },
  { name: 'counters', label: 'Counters', kind: 'json', group: 'SNMP', readOnly: true },
  // link
  { name: 'type', label: 'Type', group: 'Link', ...select(['', 'Local', 'WAN']) },
  { name: 'specialService', label: 'Special service', kind: 'text', group: 'Link' },
  { name: 'secondPOP', label: 'Second POP', kind: 'text', group: 'Link' },
  { name: 'secondHost', label: 'Second host', kind: 'text', group: 'Link' },
  { name: 'secondInterface', label: 'Second interface', kind: 'text', group: 'Link' },
  { name: 'secondDeviceType', label: 'Second device type', kind: 'text', group: 'Link' },
  { name: 'secondPOPType', label: 'Second POP type', kind: 'text', group: 'Link' },
  { name: 'label', label: 'Label', kind: 'text', group: 'Link' },
  { name: 'isUpLink', label: 'Is uplink', group: 'Link', ...select(['0', '1']) },
  { name: 'isDeviceUpLink', label: 'Is device uplink', kind: 'boolean', group: 'Link' },
  { name: 'isPOPUpLink', label: 'Is POP uplink', kind: 'boolean', group: 'Link' },
  { name: 'apiFlag', label: 'API flag', kind: 'boolean', group: 'Link' },
  { name: 'noEnrichmentFlag', label: 'No enrichment', kind: 'boolean', group: 'Link' },
  { name: 'unknownFlag', label: 'Unknown flag', kind: 'number', group: 'Link' },
  { name: 'connectionType', label: 'Connection type', kind: 'text', group: 'Link' },
  { name: 'linkType', label: 'Link type', kind: 'text', group: 'Link' },
  { name: 'linkBandwidth', label: 'Link bandwidth', kind: 'number', group: 'Link' },
  { name: 'linkID', label: 'Link ID', kind: 'text', group: 'Link' },
  { name: 'linkIP', label: 'Link IP', kind: 'text', group: 'Link' },
  { name: 'linkNumber', label: 'Link number', kind: 'text', group: 'Link' },
  // international (legacy enrichment)
  { name: 'provider', label: 'Provider', kind: 'text', group: 'International' },
  { name: 'service', label: 'Service', kind: 'text', group: 'International' },
  { name: 'subCable', label: 'Submarine cable', kind: 'text', group: 'International' },
  { name: 'teCID', label: 'TE CID', kind: 'text', group: 'International' },
  { name: 'termination', label: 'Termination', kind: 'text', group: 'International' },
  // speeds
  { name: 'actualspeed', label: 'Actual speed (bit/s)', kind: 'number', group: 'Speed' },
  { name: 'speedCat', label: 'Speed category', kind: 'text', group: 'Speed' },
  { name: 'ifSpeedText', label: 'ifSpeed text', kind: 'text', group: 'Speed' },
  { name: 'ifHighSpeedText', label: 'ifHighSpeed text', kind: 'text', group: 'Speed' },
  { name: 'sp_speedText', label: 'Parsed speed text', kind: 'text', group: 'Speed' },
  { name: 'actualspeedText', label: 'Actual speed text', kind: 'text', group: 'Speed' },
  // parsed special service
  ...SP_TEXT_FIELDS.map((field) => ({
    name: 'sp_' + field,
    label: 'sp_' + field,
    kind: 'text',
    group: 'Parsed alias',
  })),
  { name: 'sp_speed', label: 'sp_speed (bit/s)', kind: 'number', group: 'Parsed alias' },
  // device
  { name: 'hostname', label: 'Device hostname', kind: 'text', group: 'Device' },
  { name: 'ipaddress', label: 'Device IP', kind: 'text', group: 'Device' },
  { name: 'pop', label: 'POP', kind: 'text', group: 'Device' },
  { name: 'devType', label: 'Device type', kind: 'text', group: 'Device' },
  { name: 'devVendor', label: 'Device vendor', kind: 'text', group: 'Device' },
  { name: 'devModel', label: 'Device model', kind: 'text', group: 'Device' },
  { name: 'devPOP', label: 'Device POP', kind: 'text', group: 'Device' },
  { name: 'devPOPLongName', label: 'Device POP long name', kind: 'text', group: 'Device' },
  { name: 'devCabinet', label: 'Device cabinet', kind: 'text', group: 'Device' },
  { name: 'devCty', label: 'Device county', kind: 'text', group: 'Device' },
  { name: 'devDistrict', label: 'Device district', kind: 'text', group: 'Device' },
  { name: 'devSector', label: 'Device sector', kind: 'text', group: 'Device' },
  { name: 'devPOPType', label: 'Device POP type', kind: 'text', group: 'Device' },
  { name: 'btMSANCode', label: 'BT MSAN code', kind: 'text', group: 'Device' },
  { name: 'btMngIP', label: 'BT management IP', kind: 'text', group: 'Device' },
  { name: 'btSector', label: 'BT sector', kind: 'text', group: 'Device' },
  { name: 'btDistrict', label: 'BT district', kind: 'text', group: 'Device' },
  // sync / timestamps
  { name: 'delete', label: 'Marked for deletion', kind: 'boolean', group: 'Sync' },
  { name: 'syncCycles', label: 'Sync cycles missed', kind: 'number', group: 'Sync' },
  { name: 'lastSyncTime', label: 'Last sync', kind: 'date', group: 'Sync' },
  { name: 'createdAt', label: 'Created', kind: 'date', group: 'Sync', readOnly: true },
  { name: 'lastUpdate', label: 'Last update', kind: 'date', group: 'Sync', readOnly: true },
];

interfaceSchema.statics.SP_TEXT_FIELDS = SP_TEXT_FIELDS;
interfaceSchema.statics.IF_TYPE_NAMES = IF_TYPE_NAMES;

module.exports = mongoose.model('Interface', interfaceSchema);
