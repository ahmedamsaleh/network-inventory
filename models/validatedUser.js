const mongoose = require('mongoose');

const ROLES = ['admin', 'operator'];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** whitelist of the e-mail addresses allowed to sign up, with the role they get */
const ValidatedUserSchema = new mongoose.Schema({
  name: { type: String, default: '', trim: true },
  email: {
    type: String,
    required: [true, 'E-mail is required'],
    trim: true,
    lowercase: true,
    validate: { validator: (value) => EMAIL_PATTERN.test(value), message: 'E-mail is not valid' },
  },
  role: {
    type: String,
    default: 'admin',
    enum: { values: ROLES, message: 'Role must be admin or operator' },
  },
  author: {
    id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    email: String,
  },
});
ValidatedUserSchema.index({ email: 1 });

/** trimmed form values; only the fields present in `input` */
ValidatedUserSchema.statics.normalizeInput = function (input) {
  const out = {};
  for (const field of ['name', 'email', 'role']) {
    if (input[field] === undefined) continue;
    out[field] = String(input[field] === null ? '' : input[field]).trim();
  }
  if (out.email !== undefined) out.email = out.email.toLowerCase();
  return out;
};
ValidatedUserSchema.statics.ROLES = ROLES;
ValidatedUserSchema.statics.EMAIL_PATTERN = EMAIL_PATTERN;

module.exports = mongoose.model('ValidatedUser', ValidatedUserSchema);
