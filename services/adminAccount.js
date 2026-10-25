/**
 * Makes sure the configured administrator account exists (ADMIN_EMAIL /
 * ADMIN_PASSWORD). The account is whitelisted (ValidatedUser), created with
 * role "admin" and marked e-mail-verified, so it can log in right away.
 * Existing accounts are left untouched (passwords are never reset here).
 */
const User = require('../models/user');
const ValidatedUser = require('../models/validatedUser');
const config = require('../config');
const logger = require('../middleware/logger');

async function ensureAdminAccount() {
  const { email, password, name } = config.admin;
  if (!email || !password) {
    return null;
  }
  if (!(await ValidatedUser.findOne({ email }))) {
    await ValidatedUser.create({ name, email, role: 'admin' });
  }
  let user = await User.findOne({ email });
  if (user) {
    if (!user.isAuthenticated) {
      user.isAuthenticated = true;
      await user.save();
    }
    return user;
  }
  user = await User.register(new User({ name, email, role: 'admin' }), password);
  user.isAuthenticated = true;
  await user.save();
  logger.info('admin account created: ' + email);
  return user;
}

module.exports = { ensureAdminAccount };
