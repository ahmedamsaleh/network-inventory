const mongoose = require('mongoose');
const Interface = require('./interface');

/**
 * Interfaces of decommissioned devices (services/decommission.js).
 *
 * The documents keep their original _id and every Interface field, plus an
 * `archive` block saying which device / decommissioning they belong to.
 * Restoring a device moves them back into the interfaces collection.
 */
const archivedInterfaceSchema = new mongoose.Schema(
  Object.assign({}, Interface.schema.obj, {
    archive: {
      deviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Device', index: true },
      hostname: String,
      archivedAt: Date,
      by: {
        id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        email: String,
      },
      auditId: { type: mongoose.Schema.Types.ObjectId, ref: 'AuditLog' },
    },
  }),
  // no hooks / validators of the live schema: the archive is a plain copy
  { strict: false }
);

module.exports = mongoose.model('ArchivedInterface', archivedInterfaceSchema);
