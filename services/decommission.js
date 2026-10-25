/**
 * Device decommissioning (soft delete) and its undo.
 *
 *   decommissionDevice(device, { user, reason, ip })
 *     1. copies the device's live Interface documents (same _id) into the
 *        archivedinterfaces collection,
 *     2. writes the audit entry (device.decommission: reason, interface ids),
 *     3. removes the live interface documents,
 *     4. marks the device: decommissioned / decommissionedAt / decommissionedBy
 *        / decommissionReason.
 *     The embedded copy on the device (device.interfaces) is left untouched as
 *     a snapshot. Decommissioned devices drop out of every active list (the
 *     devices dataset, sync runs, imports), see Device.activeFilter.
 *
 *   restoreDevice(device, { user, ip })                       (admin)
 *     moves the archived interfaces back, clears the marker, writes
 *     device.restore.
 *
 *   deleteDevicePermanently(device, { request })              (admin)
 *     writes device.delete (snapshot of the device, its live and archived
 *     interfaces) and only then removes all of them.
 *
 * Every function resolves with a summary object and rejects on failure; the
 * audit entry is always written before anything is removed.
 */
const Device = require('../models/device');
const Interface = require('../models/interface');
const ArchivedInterface = require('../models/archivedInterface');
const Link = require('../models/link');
const audit = require('./audit');

class DecommissionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DecommissionError';
  }
}

/** live Interface documents of a device (by owner id or by hostname) */
function liveInterfaceFilter(device) {
  return { $or: [{ 'device.id': device._id }, { hostname: device.hostname }] };
}

/** what the confirmation pages show */
async function summarize(device) {
  const [interfaces, archived, links] = await Promise.all([
    Interface.countDocuments(liveInterfaceFilter(device)),
    ArchivedInterface.countDocuments({ 'archive.deviceId': device._id }),
    Link.countDocuments({ $or: [{ device1: device.hostname }, { device2: device.hostname }] }),
  ]);
  return { interfaces, archived, links, embedded: (device.interfaces || []).length };
}

/** inserts ignoring duplicate-key errors; resolves with the number inserted */
async function insertIgnoringDuplicates(Model, docs) {
  if (docs.length === 0) return 0;
  try {
    const inserted = await Model.insertMany(docs, { ordered: false });
    return inserted.length;
  } catch (error) {
    const duplicates = (error.writeErrors || []).filter((item) => item.code === 11000);
    if (
      error.code === 11000 ||
      (duplicates.length && duplicates.length === error.writeErrors.length)
    ) {
      return (error.insertedDocs && error.insertedDocs.length) || 0;
    }
    throw error;
  }
}

async function decommissionDevice(device, { user, reason, ip } = {}) {
  if (!device) throw new DecommissionError('device not found');
  if (device.decommissioned) {
    throw new DecommissionError('device ' + device.hostname + ' is already decommissioned');
  }
  const now = new Date();
  const actor = user ? { id: user._id, email: user.email } : audit.SYSTEM;
  const interfaces = await Interface.find(liveInterfaceFilter(device)).lean();
  const entry = await audit.record({
    action: 'device.decommission',
    user: actor,
    ip,
    target: { type: 'device', id: String(device._id), label: device.hostname },
    details: {
      reason: reason || '',
      ipaddress: device.ipaddress,
      interfacesArchived: interfaces.length,
      interfaceIds: interfaces.map((intf) => String(intf._id)),
    },
  });
  const archive = { deviceId: device._id, hostname: device.hostname, archivedAt: now, by: actor };
  archive.auditId = entry._id;
  const archived = await insertIgnoringDuplicates(
    ArchivedInterface,
    interfaces.map((intf) => Object.assign({}, intf, { archive }))
  );
  await Interface.deleteMany({ _id: { $in: interfaces.map((intf) => intf._id) } });
  await Device.updateOne(
    { _id: device._id },
    {
      $set: {
        decommissioned: true,
        decommissionedAt: now,
        decommissionedBy: actor,
        decommissionReason: reason || '',
        updatedAt: now,
        lastUpdatedBy: actor,
      },
    }
  );
  return { hostname: device.hostname, archived, auditId: entry._id };
}

async function restoreDevice(device, { user, ip } = {}) {
  if (!device) throw new DecommissionError('device not found');
  if (!device.decommissioned) {
    throw new DecommissionError('device ' + device.hostname + ' is not decommissioned');
  }
  const now = new Date();
  const actor = user ? { id: user._id, email: user.email } : audit.SYSTEM;
  const archived = await ArchivedInterface.find({ 'archive.deviceId': device._id }).lean();
  const entry = await audit.record({
    action: 'device.restore',
    user: actor,
    ip,
    target: { type: 'device', id: String(device._id), label: device.hostname },
    details: {
      ipaddress: device.ipaddress,
      decommissionedAt: device.decommissionedAt,
      decommissionedBy: device.decommissionedBy && device.decommissionedBy.email,
      interfacesRestored: archived.length,
      interfaceIds: archived.map((intf) => String(intf._id)),
    },
  });
  const restored = await insertIgnoringDuplicates(
    Interface,
    archived.map((intf) => {
      const copy = Object.assign({}, intf);
      delete copy.archive;
      return copy;
    })
  );
  await ArchivedInterface.deleteMany({ _id: { $in: archived.map((intf) => intf._id) } });
  await Device.updateOne(
    { _id: device._id },
    {
      $set: { decommissioned: false, updatedAt: now, lastUpdatedBy: actor, restoredAt: now },
      $unset: { decommissionedAt: 1, decommissionedBy: 1, decommissionReason: 1 },
    }
  );
  return { hostname: device.hostname, restored, auditId: entry._id };
}

/** permanent removal of a device with its live + archived interfaces (audit first) */
async function deleteDevicePermanently(device, { request } = {}) {
  if (!device) throw new DecommissionError('device not found');
  const [interfaces, archived] = await Promise.all([
    Interface.find(liveInterfaceFilter(device)).lean(),
    ArchivedInterface.find({ 'archive.deviceId': device._id }).lean(),
  ]);
  const entry = await audit.recordDeletion(request, 'device', device, {
    decommissioned: Boolean(device.decommissioned),
    interfacesDeleted: interfaces.length,
    archivedInterfacesDeleted: archived.length,
    interfaces,
    archivedInterfaces: archived,
  });
  await Interface.deleteMany({ _id: { $in: interfaces.map((intf) => intf._id) } });
  await ArchivedInterface.deleteMany({ _id: { $in: archived.map((intf) => intf._id) } });
  await Device.deleteOne({ _id: device._id });
  return {
    hostname: device.hostname,
    interfaces: interfaces.length,
    archived: archived.length,
    auditId: entry._id,
  };
}

module.exports = {
  DecommissionError,
  decommissionDevice,
  restoreDevice,
  deleteDevicePermanently,
  summarize,
  liveInterfaceFilter,
};
