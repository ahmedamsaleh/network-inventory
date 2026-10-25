const mongoose = require('mongoose');

const UNKNOWN = 'Unknown';

/**
 * A cabinet: the first segment of a device hostname (ONGAR in
 * ONGAR-R39J-D-IR) and the POP (short name) it belongs to.
 */
const cabinetSchema = new mongoose.Schema({
  cabinet: { type: String, required: [true, 'Cabinet name is required'], trim: true },
  // the POP's shortName (not its id)
  pop: { type: String, default: UNKNOWN, trim: true },
  // geo-location, e.g. "53.2412,-6.4367"
  location: { type: String, default: '', trim: true },
  // how to reach the location
  locNotes: { type: String, default: '', trim: true },
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
cabinetSchema.index({ cabinet: 1 }, { unique: true });

const TEXT_FIELDS = ['cabinet', 'pop', 'location', 'locNotes'];
const DEFAULTS = { pop: UNKNOWN, location: '', locNotes: '' };

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

/** the cabinet name of a hostname: its first "-" segment */
function cabinetOfHostname(hostname) {
  return String(hostname || '')
    .split('-')[0]
    .trim();
}

cabinetSchema.statics.UNKNOWN = UNKNOWN;
cabinetSchema.statics.TEXT_FIELDS = TEXT_FIELDS;
cabinetSchema.statics.normalizeInput = normalizeInput;
cabinetSchema.statics.cabinetOfHostname = cabinetOfHostname;
/** case-insensitive lookup by cabinet name */
cabinetSchema.statics.findByName = function (name) {
  const text = String(name || '').trim();
  if (!text) return Promise.resolve(null);
  return this.findOne({
    cabinet: new RegExp('^' + text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i'),
  });
};

module.exports = mongoose.model('Cabinet', cabinetSchema);
