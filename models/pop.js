const mongoose = require('mongoose');
const mongoosePaginate = require('mongoose-paginate-v2');

//Database template setup
const popSchema = new mongoose.Schema({
  name: String,
  shortName: String,
  governorateAcro: {
    id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Governorate',
    },
    acronym: String,
  },
  district: String,
  sector: {
    id: {
      type: mongoose.Schema.Types.ObjectId,
      //ref is the name of the model
      ref: 'Sector',
    },
    name: String,
  },
  author: {
    id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    email: String,
  },
});

popSchema.plugin(mongoosePaginate);
const POP = mongoose.model('POP', popSchema);

module.exports = POP; //mongoose.model("POP", popSchema);
