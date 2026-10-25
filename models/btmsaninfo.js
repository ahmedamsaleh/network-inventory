const mongoose = require('mongoose');

const UNKNOWN = 'Unknown';

/**
 * BT MSAN reference data: one row per MSAN (code, management IP, sector,
 * district). Used by the sync to fill btMSANCode / btMngIP / btSector /
 * btDistrict on devices and interfaces.
 */
const btMsanInfoSchema = new mongoose.Schema({
  msanCode: { type: String, required: [true, 'MSAN code is required'], trim: true },
  mngIP: {
    type: String,
    default: '',
    trim: true,
    validate: {
      validator: (value) =>
        value === '' ||
        (/^\d{1,3}(\.\d{1,3}){3}$/.test(value) &&
          value.split('.').every((part) => Number(part) <= 255)),
      message: 'Management IP must be a valid IPv4 address (or blank)',
    },
  },
  sector: { type: String, default: UNKNOWN, trim: true },
  district: { type: String, default: UNKNOWN, trim: true },
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
btMsanInfoSchema.index({ msanCode: 1 }, { unique: true });
btMsanInfoSchema.index({ mngIP: 1 });

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const TEXT_FIELDS = ['msanCode', 'mngIP', 'sector', 'district', 'notes'];
const DEFAULTS = { mngIP: '', sector: UNKNOWN, district: UNKNOWN, notes: '' };

/** trimmed form values; blank -> default; only the fields present in `input` */
function normalizeInput(input) {
  const out = {};
  for (const field of TEXT_FIELDS) {
    if (input[field] === undefined) continue;
    const value = String(input[field] === null ? '' : input[field]).trim();
    out[field] = value === '' && DEFAULTS[field] !== undefined ? DEFAULTS[field] : value;
  }
  return out;
}

// MSAN codes are unique regardless of case (lookups are case-insensitive)
btMsanInfoSchema.pre('validate', async function () {
  if (!this.msanCode) return;
  const other = await this.constructor
    .findOne({
      _id: { $ne: this._id },
      msanCode: new RegExp('^' + escapeRegExp(this.msanCode) + '$', 'i'),
    })
    .lean();
  if (other) this.invalidate('msanCode', 'A BT MSAN entry with that code already exists');
});

btMsanInfoSchema.statics.UNKNOWN = UNKNOWN;
btMsanInfoSchema.statics.TEXT_FIELDS = TEXT_FIELDS;
btMsanInfoSchema.statics.normalizeInput = normalizeInput;
/** case-insensitive lookup by MSAN code */
btMsanInfoSchema.statics.findByCode = function (code) {
  const text = String(code || '').trim();
  if (!text) return Promise.resolve(null);
  return this.findOne({ msanCode: new RegExp('^' + escapeRegExp(text) + '$', 'i') }).lean();
};
/** lookup by management IP */
btMsanInfoSchema.statics.findByMngIP = function (ip) {
  const text = String(ip || '').trim();
  if (!text) return Promise.resolve(null);
  return this.findOne({ mngIP: text }).lean();
};

module.exports = mongoose.model('BTMSANInfo', btMsanInfoSchema);
