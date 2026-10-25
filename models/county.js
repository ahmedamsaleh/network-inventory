const mongoose = require('mongoose');
const mongoosePaginate = require('mongoose-paginate-v2');
//Database template setup
const countySchema = new mongoose.Schema({
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

countySchema.plugin(mongoosePaginate);

const County = mongoose.model('County', countySchema);
module.exports = County; //mongoose.model("County", countySchema);
