const mongoose = require('mongoose');

/**
 * Unparsed SNMP interface rows as collected by services/syncDevice.js, one
 * document per (hostname, ifIndex), overwritten on every sync cycle.
 */
const rawInterfaceSchema = new mongoose.Schema({
  hostname: { type: String, required: true },
  ipaddress: String,
  deviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Device' },
  ifIndex: { type: Number, required: true },
  // raw ifTable/ifXTable values exactly as returned by the device (before any vendor workaround)
  columns: { type: mongoose.Schema.Types.Mixed, default: {} },
  sys: {
    sysDescr: String,
    sysObjectID: String,
    sysName: String,
  },
  vendor: String,
  collectedAt: { type: Date, default: Date.now },
});
rawInterfaceSchema.index({ hostname: 1, ifIndex: 1 }, { unique: true });

module.exports = mongoose.model('RawInterface', rawInterfaceSchema);
