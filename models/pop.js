const mongoose = require('mongoose');
const mongoosePaginate = require('mongoose-paginate-v2');

const UNKNOWN = 'Unknown';

//Database template setup
const popSchema = new mongoose.Schema({
  name: { type: String, required: [true, 'POP name is required'], trim: true },
  // short name, e.g. ONGAR; device hostnames start with it (<POP>-<TYPE><NN><VENDOR>-...)
  shortName: { type: String, required: [true, 'POP short name is required'], trim: true },
  countyAcro: {
    id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'County',
    },
    acronym: String,
  },
  // county acronym
  cty: { type: String, default: UNKNOWN },
  district: { type: String, default: UNKNOWN },
  // plain sector name (the former {id, name} relation was never populated)
  sector: { type: String, default: UNKNOWN },
  popType: { type: String, default: UNKNOWN },
  popLongName: { type: String, default: UNKNOWN },
  // computed: shortName + "_" + cty
  pop_cty: { type: String, default: UNKNOWN },
  // parent POP in the POP hierarchy (shortName_cty), when any
  parentPOP: { type: String, default: UNKNOWN },
  author: {
    id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    email: String,
  },
});
popSchema.index({ shortName: 1 });

/** shortName + "_" + cty, or "Unknown" when either part is missing */
function computePopCty(shortName, cty) {
  const left = String(shortName || '').trim();
  const right = String(cty || '').trim();
  if (!left || !right || right === UNKNOWN) return UNKNOWN;
  return left + '_' + right;
}

/** text fields the forms / the POPs sheet may set, with their defaults */
const TEXT_FIELDS = ['name', 'shortName', 'cty', 'district', 'sector', 'popType', 'popLongName'];
const DEFAULTS = {
  cty: UNKNOWN,
  district: UNKNOWN,
  sector: UNKNOWN,
  popType: UNKNOWN,
  popLongName: UNKNOWN,
};

/**
 * Normalizes submitted values: trimmed strings; blank -> default (when the
 * field has one) or unset. Returns only the fields present in `input`.
 * pop_cty is always recomputed from the result when shortName/cty are known.
 */
function normalizeInput(input, current) {
  const out = {};
  for (const field of TEXT_FIELDS) {
    if (input[field] === undefined) continue;
    const value = String(input[field] === null ? '' : input[field]).trim();
    if (value === '') {
      if (DEFAULTS[field] !== undefined) out[field] = DEFAULTS[field];
    } else {
      out[field] = value;
    }
  }
  if (input.countyAcro !== undefined && out.cty === undefined) {
    const acronym =
      typeof input.countyAcro === 'object' && input.countyAcro
        ? input.countyAcro.acronym
        : input.countyAcro;
    const value = String(acronym || '').trim();
    out.cty = value || UNKNOWN;
  }
  const shortName = out.shortName !== undefined ? out.shortName : current && current.shortName;
  const cty = out.cty !== undefined ? out.cty : current && current.cty;
  if (out.shortName !== undefined || out.cty !== undefined) {
    out.pop_cty = computePopCty(shortName, cty);
  }
  return out;
}

popSchema.pre('validate', function () {
  if (this.cty === UNKNOWN && this.countyAcro && this.countyAcro.acronym) {
    this.cty = this.countyAcro.acronym;
  }
  this.pop_cty = computePopCty(this.shortName, this.cty);
});

popSchema.statics.UNKNOWN = UNKNOWN;
popSchema.statics.TEXT_FIELDS = TEXT_FIELDS;
popSchema.statics.computePopCty = computePopCty;
popSchema.statics.normalizeInput = normalizeInput;

popSchema.plugin(mongoosePaginate);
const POP = mongoose.model('POP', popSchema);

module.exports = POP; //mongoose.model("POP", popSchema);
