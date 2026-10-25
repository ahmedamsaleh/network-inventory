/**
 * Audit trail (models/auditlog.js).
 *
 * Rule enforced throughout the app: nothing is deleted permanently without
 * an audit entry. record() therefore *throws* when the entry cannot be
 * written, and every destructive route awaits it before touching the data
 * (see recordDeletion / the DELETE handlers). Reversible operations
 * (decommission / restore) are logged the same way.
 */
const AuditLog = require('../models/auditlog');
const logger = require('../middleware/logger');

const ANONYMOUS = { email: 'anonymous' };
const SYSTEM = { email: 'system' };

/** { id, email } of the request's user (or 'anonymous' on unguarded routes) */
function actorOf(request) {
  if (request && request.user) {
    return { id: request.user._id, email: request.user.email };
  }
  return { ...ANONYMOUS };
}

function plain(doc) {
  if (!doc) return doc;
  return typeof doc.toObject === 'function' ? doc.toObject({ depopulate: true }) : doc;
}

/** the value most people would call "the name" of a document */
function labelOf(doc) {
  if (!doc) return '';
  for (const key of [
    'hostname',
    'name',
    'cabinet',
    'msanCode',
    'email',
    'ifName',
    'device1',
    'acronym',
  ]) {
    if (doc[key]) return String(doc[key]);
  }
  return String(doc._id || '');
}

/**
 * Writes one entry; rejects when it cannot be stored.
 * @param {object} entry { action, user, target: {type, id, label}, details, ip }
 * @returns {Promise<object>} the stored AuditLog document
 */
async function record(entry) {
  if (!entry || !entry.action) throw new Error('audit: action is required');
  const doc = await AuditLog.create({
    action: entry.action,
    at: entry.at || new Date(),
    user: entry.user || SYSTEM,
    target: entry.target || {},
    ip: entry.ip,
    details: entry.details === undefined ? {} : entry.details,
  });
  logger.info(
    'audit: ' +
      doc.action +
      ' ' +
      (doc.target && doc.target.type ? doc.target.type + ' ' : '') +
      (doc.target && doc.target.label ? doc.target.label : '') +
      ' by ' +
      (doc.user && doc.user.email)
  );
  return doc;
}

/**
 * Audit entry for a permanent deletion, written BEFORE the delete: the full
 * document is stored as `details.snapshot`, so the entry is the last copy.
 * @param {object} request   express request (user / ip)
 * @param {string} type      'device' | 'interface' | 'pop' | ...
 * @param {object} doc       the document about to be deleted
 * @param {object} [details] extra context merged into details
 */
const SECRET_FIELDS = ['hash', 'salt', 'password', 'authToken'];

function recordDeletion(request, type, doc, details) {
  const snapshot = plain(doc);
  // credentials never go into the log (user / validated user snapshots)
  if (snapshot && typeof snapshot === 'object') {
    for (const field of SECRET_FIELDS) delete snapshot[field];
  }
  return record({
    action: type + '.delete',
    user: actorOf(request),
    ip: request && request.ip,
    target: { type, id: String(doc._id), label: labelOf(snapshot) },
    details: Object.assign({ snapshot }, details || {}),
  });
}

/**
 * find -> audit -> delete, for the simple DELETE /:id routes. Resolves with
 * the deleted document, or null when the id is malformed / unknown (nothing
 * is deleted and nothing is logged in that case). Rejects when the audit
 * entry cannot be written (the document is then left alone).
 */
async function deleteById(request, type, Model, id) {
  let doc = null;
  try {
    doc = await Model.findById(id);
  } catch (error) {
    if (error.name !== 'CastError') throw error;
  }
  if (!doc) return null;
  await recordDeletion(request, type, doc);
  await Model.deleteOne({ _id: doc._id });
  return doc;
}

module.exports = {
  record,
  recordDeletion,
  deleteById,
  actorOf,
  labelOf,
  plain,
  ANONYMOUS,
  SYSTEM,
};
