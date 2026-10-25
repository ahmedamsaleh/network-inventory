const mongoose = require('mongoose');

/**
 * Audit trail of destructive / reversible operations (services/audit.js).
 *
 *   action   dotted verb, e.g. device.decommission, device.restore,
 *            device.delete, interface.delete, pop.delete, enrichment.clear
 *   user     who did it (request.user); { email: 'anonymous' } on the
 *            routes that still have no login guard, 'system' for jobs
 *   target   what it was done to (type + id + human label)
 *   details  free-form context: reason, counts, and - for permanent
 *            deletions - a full snapshot of the removed document(s)
 *
 * Entries are written BEFORE the operation they describe, so a missing audit
 * write aborts the operation (never the other way round).
 */
const auditLogSchema = new mongoose.Schema({
  action: { type: String, required: true, index: true },
  at: { type: Date, default: Date.now, index: true },
  user: {
    id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    email: String,
  },
  target: {
    type: { type: String, index: true },
    id: String,
    label: String,
  },
  ip: String,
  details: mongoose.Schema.Types.Mixed,
});
auditLogSchema.index({ 'target.id': 1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
