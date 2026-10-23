const mongoose = require('mongoose');

const ValidatedUserSchema = new mongoose.Schema({
  name: String,
  email: String,
  role: { type: String, default: 'admin' },
  author: {
    id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    email: String,
  },
});
// ValidatedUserSchema.plugin(passportLocalMongoose,{usernameField: 'email'});//User.serializeUser() and User.deserializeUser() are defined here

module.exports = mongoose.model('ValidatedUser', ValidatedUserSchema);
