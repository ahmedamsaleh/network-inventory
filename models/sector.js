const mongoose = require('mongoose');
const mongoosePaginate = require('mongoose-paginate-v2');
const sectorSchema = new mongoose.Schema({
  name: { type: String, required: [true, 'Sector name is required'], trim: true },
  description: { type: String, default: '', trim: true },
  author: {
    id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    email: String,
  },
});
sectorSchema.index({ name: 1 });

/** trimmed form values; only the fields present in `input` */
sectorSchema.statics.normalizeInput = function (input) {
  const out = {};
  for (const field of ['name', 'description']) {
    if (input[field] === undefined) continue;
    out[field] = String(input[field] === null ? '' : input[field]).trim();
  }
  return out;
};

sectorSchema.plugin(mongoosePaginate);
const Sector = mongoose.model('Sector', sectorSchema);

module.exports = Sector; //mongoose.model("Sector", sectorSchema);
