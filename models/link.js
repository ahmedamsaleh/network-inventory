const mongoose = require('mongoose');
//Database template setup
const linkSchema = new mongoose.Schema({
  device1: String,
  interface1: String,
  device2: String,
  interface2: String,
  // classification (same vocabulary as the interface fields)
  type: { type: String, default: '' }, // Local | WAN
  specialService: { type: String, default: '' },
  pop1: String,
  pop2: String,
  label: String,
  speed: Number, // bit/s
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

module.exports = mongoose.model('Link', linkSchema);
