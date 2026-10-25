const mongoose = require('mongoose');

const LINK_TYPES = ['', 'Local', 'WAN'];

const linkSchema = new mongoose.Schema({
  device1: { type: String, required: [true, 'Device 1 is required'], trim: true },
  interface1: { type: String, default: '', trim: true },
  device2: { type: String, required: [true, 'Device 2 is required'], trim: true },
  interface2: { type: String, default: '', trim: true },
  type: {
    type: String,
    default: '',
    enum: { values: LINK_TYPES, message: 'Type must be Local or WAN' },
  },
  specialService: { type: String, default: '', trim: true },
  pop1: { type: String, default: '', trim: true },
  pop2: { type: String, default: '', trim: true },
  label: { type: String, default: '', trim: true },
  speed: {
    type: Number, // bit/s
    min: [0, 'Speed cannot be negative'],
  },
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
linkSchema.index({ device1: 1 });
linkSchema.index({ device2: 1 });

const TEXT_FIELDS = [
  'device1',
  'interface1',
  'device2',
  'interface2',
  'type',
  'specialService',
  'pop1',
  'pop2',
  'label',
];

/**
 * Trimmed form values; only the fields present in `input`. `speed` accepts
 * a number of bit/s (blank -> unset); a non-numeric value is kept as NaN so
 * that validation reports it.
 */
linkSchema.statics.normalizeInput = function (input) {
  const out = {};
  for (const field of TEXT_FIELDS) {
    if (input[field] === undefined) continue;
    out[field] = String(input[field] === null ? '' : input[field]).trim();
  }
  if (input.speed !== undefined) {
    const text = String(input.speed === null ? '' : input.speed).trim();
    out.speed = text === '' ? null : Number(text);
  }
  return out;
};

linkSchema.statics.LINK_TYPES = LINK_TYPES;
linkSchema.statics.TEXT_FIELDS = TEXT_FIELDS;

module.exports = mongoose.model('Link', linkSchema);
