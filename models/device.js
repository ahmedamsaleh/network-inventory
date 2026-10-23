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

//Database template setup
const deviceSchema = new mongoose.Schema({
  // hostname: {type: String, required: [true, 'Hostname is required'], validate: hostnameValidator},
  hostname: String,
  ipaddress: String,
  communityString: { type: String, default: config.snmp.defaultCommunity },
  createdAt: { type: Date, default: Date.now },
  updatedAt: Date,
  description: String,
  discovered: { type: Boolean, default: false }, //used to mark device as discovered, useful during sync process
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
    name: String,
  },
  governorate: {
    id: {
      type: mongoose.Schema.Types.ObjectId,
      //ref is the name of the model
      ref: 'Governorate',
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
