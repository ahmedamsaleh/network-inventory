const mongoose = require('mongoose');
const mongoosePaginate = require('mongoose-paginate-v2');
//Database template setup
const governorateSchema = new mongoose.Schema({
  name: { type: String, required: [true, 'Name is required'] },
  acronym: String,
  author: {
    id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    email: String,
  },
});

governorateSchema.plugin(mongoosePaginate);

const Governorate = mongoose.model('Governorate', governorateSchema);
module.exports = Governorate; //mongoose.model("Governorate", governorateSchema);
