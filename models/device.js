const mongoose = require('mongoose');
const Interface = require('./interface');
const Address4 = require('ip-address').Address4;
const config = require('../config');

const hostnameEmpty = function (val) {
  if (val && val.length != 0) {
    return true;
  }
  return false;
};
const hostnameLength = function (val) {
  if (val && val.length >= 5) {
    return true;
  }
  return false;
};
const ipaddressEmpty = function (val) {
  if (val && val.length != 0) {
    return true;
  }
  return false;
};
const validIP = function (val) {
  if (val && new Address4(val).isValid()) {
    return true;
  }
  return false;
};

// default for the descriptive fields below (spelling kept as specified: 'Unkown')
const UNKNOWN = 'Unkown';

//Database template setup
const deviceSchema = new mongoose.Schema({
  // hostname: {type: String, required: [true, 'Hostname is required'], validate: hostnameValidator},
  hostname: String,
  ipaddress: String,
  // SNMP community (DEFAULT_SNMP_COMMUNITY or 'public'); `communityString` is the
  // legacy name of the same value and is kept in sync by the routes
  community: { type: String, default: config.snmp.defaultCommunity },
  communityString: { type: String, default: config.snmp.defaultCommunity },
  createdAt: { type: Date, default: Date.now },
  updatedAt: Date,
  lastSyncTime: Date,
  description: String,
  // SNMP system group (populated by discovery/sync)
  sysDescr: String,
  sysObjectID: String,
  sysName: String,
  discovered: { type: Boolean, default: false }, //used to mark device as discovered, useful during sync process
  deviceSyncCycles: { type: Number, default: 0 },
  defaultCollector: { type: Number, default: 1 },
  popName: {
    id: {
      type: mongoose.Schema.Types.ObjectId,
      //ref is the name of the model
      ref: 'POP',
    },
    name: String,
  },
  sector: {
    id: {
      type: mongoose.Schema.Types.ObjectId,
      //ref is the name of the model
      ref: 'Sector',
    },
    name: { type: String, default: UNKNOWN },
  },
  county: {
    id: {
      type: mongoose.Schema.Types.ObjectId,
      //ref is the name of the model
      ref: 'County',
    },
    name: String,
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
  type: String,
  model: String,
  vendor: String,
  // location / site information
  pop: String,
  popLongName: { type: String, default: UNKNOWN },
  cabinet: { type: String, default: UNKNOWN },
  cty: { type: String, default: UNKNOWN },
  district: { type: String, default: UNKNOWN },
  popType: { type: String, default: UNKNOWN },
  // BT (bitstream) reference data
  btMSANCode: String,
  btMngIP: String,
  btSector: String,
  btDistrict: String,
  // SNMP responsiveness (services/snmpProfile.js): a device "known to be slow"
  // - flagged by hand or after SNMP_SLOW_AFTER_TIMEOUTS consecutive timeouts -
  // is polled with the short SNMP_SLOW_TIMEOUT_MS / SNMP_SLOW_RETRIES profile
  snmpSlow: { type: Boolean, default: false },
  snmpTimeouts: { type: Number, default: 0 }, // consecutive sync timeouts (reset on success)
  lastSyncError: String,
  // decommissioning = soft delete (services/decommission.js); decommissioned
  // devices are excluded from every active list, see Device.activeFilter
  decommissioned: { type: Boolean, default: false },
  decommissionedAt: Date,
  decommissionedBy: {
    id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    email: String,
  },
  decommissionReason: String,
  restoredAt: Date,
  interfaces: [Interface.schema],
  // interfaces: [
  //         {
  //             id: {
  //                     type: mongoose.Schema.Types.ObjectId,
  //                     //ref is the name of the model
  //                     ref: "Interface"
  //                 },
  //             name: String
  //         }
  //     ]
});
deviceSchema.index({ hostname: 1 }, { unique: true });
deviceSchema.index({ ipaddress: 1 });
deviceSchema.index({ decommissioned: 1, hostname: 1 });

/** query filter for the devices that are in service (not decommissioned) */
deviceSchema.statics.activeFilter = function (filter) {
  return Object.assign({ decommissioned: { $ne: true } }, filter || {});
};

// free-text fields the create/update forms may set (all trimmed by the routes)
deviceSchema.statics.editableTextFields = [
  'description',
  'community',
  'type',
  'model',
  'vendor',
  'pop',
  'popLongName',
  'cabinet',
  'cty',
  'district',
  'popType',
  'btMSANCode',
  'btMngIP',
  'btSector',
  'btDistrict',
];

deviceSchema.path('hostname').validate(hostnameEmpty, "hostname can't be empty!");
deviceSchema.path('hostname').validate(hostnameLength, 'hostname is too short!');
deviceSchema.path('ipaddress').validate(ipaddressEmpty, "IP Address can't be empty!");
deviceSchema.path('ipaddress').validate(validIP, 'IP address is not valid');

const Device = mongoose.model('Device', deviceSchema);

// async validators: resolve to false when another document already uses the value
deviceSchema.path('hostname').validate(async function (value) {
  let hostnames;
  try {
    hostnames = await Device.find({ hostname: value });
  } catch (err) {
    // console.log(err);
    return false;
  }
  // console.log('Number found: ' + hostnames.length);
  return hostnames.length === 0;
}, 'Duplicate hostname');

deviceSchema.path('ipaddress').validate(async function (value) {
  let ipaddresses;
  try {
    ipaddresses = await Device.find({ ipaddress: value });
  } catch (err) {
    // console.log(err);
    return false;
  }
  console.log('Number found: ' + ipaddresses.length);
  return ipaddresses.length === 0;
}, 'Duplicate IP');

module.exports = Device; //mongoose.model("Device", deviceSchema);
