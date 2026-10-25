const mongoose = require('mongoose');

const DEVICE_TYPES = ['Router', 'Switch', 'Access Switch', 'DSLAM', 'MSAN'];

/**
 * A device model (e.g. "MX480" / Juniper / Router) and the sysObjectIDs that
 * identify it. An entry in `sysObjectIDs` matches a device's sysObjectID
 * when it is equal to it or a prefix of it (OID subtree); the most specific
 * (longest) match wins.
 */
const deviceModelSchema = new mongoose.Schema({
  name: { type: String, required: [true, 'Model name is required'], trim: true },
  vendor: { type: String, default: '', trim: true },
  type: { type: String, default: '', trim: true },
  sysObjectIDs: { type: [String], default: [] },
  notes: { type: String, default: '', trim: true },
  createdAt: { type: Date, default: Date.now },
  lastUpdate: Date,
  author: {
    id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    email: String,
  },
});
deviceModelSchema.index({ name: 1 }, { unique: true });
deviceModelSchema.index({ sysObjectIDs: 1 });

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** "1.3.6.1.4.1.2636.1.1.1.2.25" -> normalized OID string, '' when invalid */
function normalizeOid(value) {
  const text = String(value || '')
    .trim()
    .replace(/^\./, '');
  return /^\d+(\.\d+)*$/.test(text) ? text : '';
}

/** trimmed form values; sysObjectIDs from a textarea (one per line) or a comma list */
function normalizeInput(input) {
  const out = {};
  for (const field of ['name', 'vendor', 'type', 'notes']) {
    if (input[field] === undefined) continue;
    out[field] = String(input[field] === null ? '' : input[field]).trim();
  }
  if (input.sysObjectIDs !== undefined) {
    const raw = Array.isArray(input.sysObjectIDs)
      ? input.sysObjectIDs.join('\n')
      : String(input.sysObjectIDs || '');
    out.sysObjectIDs = [
      ...new Set(
        raw
          .split(/[\n,;\s]+/)
          .map(normalizeOid)
          .filter(Boolean)
      ),
    ];
  }
  return out;
}

function matchesOid(pattern, sysObjectID) {
  return sysObjectID === pattern || sysObjectID.startsWith(pattern + '.');
}

// model names are unique regardless of case (lookups are case-insensitive)
deviceModelSchema.pre('validate', async function () {
  if (!this.name) return;
  const Model = this.constructor;
  const other = await Model.findOne({
    _id: { $ne: this._id },
    name: new RegExp('^' + escapeRegExp(this.name) + '$', 'i'),
  }).lean();
  if (other) {
    this.invalidate('name', 'A device model with that name already exists');
  }
});

deviceModelSchema.statics.DEVICE_TYPES = DEVICE_TYPES;
deviceModelSchema.statics.normalizeInput = normalizeInput;
deviceModelSchema.statics.normalizeOid = normalizeOid;
deviceModelSchema.statics.matchesOid = matchesOid;

/** the model whose sysObjectID entry is the longest match of the given OID */
deviceModelSchema.statics.findBySysObjectID = async function (sysObjectID) {
  const oid = normalizeOid(sysObjectID);
  if (!oid) return null;
  const candidates = await this.find({ sysObjectIDs: { $exists: true, $ne: [] } }).lean();
  let best = null;
  let bestLength = -1;
  for (const candidate of candidates) {
    for (const pattern of candidate.sysObjectIDs) {
      if (matchesOid(pattern, oid) && pattern.length > bestLength) {
        best = candidate;
        bestLength = pattern.length;
      }
    }
  }
  return best;
};

/** case-insensitive lookup by model name */
deviceModelSchema.statics.findByName = function (name) {
  const text = String(name || '').trim();
  if (!text) return Promise.resolve(null);
  return this.findOne({ name: new RegExp('^' + escapeRegExp(text) + '$', 'i') }).lean();
};

/**
 * Vendor/type/model for a device: by sysObjectID first (authoritative), then
 * by model name. Returns { model, vendor, type, matchedBy } or null.
 */
deviceModelSchema.statics.resolve = async function ({ sysObjectID, model } = {}) {
  const byOid = await this.findBySysObjectID(sysObjectID);
  if (byOid)
    return { model: byOid.name, vendor: byOid.vendor, type: byOid.type, matchedBy: 'sysObjectID' };
  const byName = await this.findByName(model);
  if (byName)
    return { model: byName.name, vendor: byName.vendor, type: byName.type, matchedBy: 'model' };
  return null;
};

module.exports = mongoose.model('DeviceModel', deviceModelSchema);
