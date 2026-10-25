const mongoose = require('mongoose');
const mongoosePaginate = require('mongoose-paginate-v2');
const countySchema = new mongoose.Schema({
  name: { type: String, required: [true, 'Name is required'], trim: true },
  acronym: {
    type: String,
    default: '',
    trim: true,
    validate: {
      validator: (value) => value === '' || /^[A-Za-z0-9]{1,6}$/.test(value),
      message: 'Acronym must be 1-6 letters or digits',
    },
  },
  author: {
    id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    email: String,
  },
});
countySchema.index({ name: 1 });

/** trimmed form values; only the fields present in `input` */
countySchema.statics.normalizeInput = function (input) {
  const out = {};
  for (const field of ['name', 'acronym']) {
    if (input[field] === undefined) continue;
    out[field] = String(input[field] === null ? '' : input[field]).trim();
  }
  if (out.acronym !== undefined) out.acronym = out.acronym.toUpperCase();
  return out;
};

countySchema.plugin(mongoosePaginate);

const County = mongoose.model('County', countySchema);
module.exports = County; //mongoose.model("County", countySchema);
