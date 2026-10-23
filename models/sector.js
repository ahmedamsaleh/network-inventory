const mongoose = require('mongoose');
const mongoosePaginate = require('mongoose-paginate-v2');
//Database template setup
const sectorSchema = new mongoose.Schema({
  name: String,
  description: String,
  author: {
    id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    email: String,
  },
});
sectorSchema.plugin(mongoosePaginate);
const Sector = mongoose.model('Sector', sectorSchema);

module.exports = Sector; //mongoose.model("Sector", sectorSchema);
