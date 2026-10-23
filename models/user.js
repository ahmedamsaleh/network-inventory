const mongoose = require('mongoose'),
  crypto = require('crypto'),
  passportLocalMongoose = require('passport-local-mongoose').default;

const UserSchema = new mongoose.Schema({
  name: String,
  // email: String,
  password: String,
  role: { type: String, default: 'admin' },
  // e-mail verification state (previously provided by passport-local-mongoose-email)
  authToken: String,
  isAuthenticated: Boolean,
});

//User.serializeUser() and User.deserializeUser() are defined here
UserSchema.plugin(passportLocalMongoose, {
  usernameField: 'email',
  // passport-local-mongoose-email hashed with pbkdf2/SHA1 (25000 iterations,
  // keylen 512, hex). Keep the same digest so already stored credentials keep
  // working; switching to the plugin default (sha256) needs a password reset.
  digestAlgorithm: 'sha1',
  errorMessages: {
    MissingUsernameError: 'Field email is not set',
    IncorrectUsernameError: 'Incorrect username',
    IncorrectPasswordError: 'Incorrect password',
    UserExistsError: 'User already exists with that email',
  },
});

//======================
// E-mail verification (behavior of the former passport-local-mongoose-email plugin)
//======================
const pluginRegister = UserSchema.statics.register;
const pluginAuthenticate = UserSchema.statics.authenticate;

// register() stores the user unverified together with a random authToken
UserSchema.statics.register = function (user, password, saveOptions) {
  if (!(user instanceof this)) {
    user = new this(user);
  }
  user.authToken = crypto.randomBytes(48).toString('hex');
  user.isAuthenticated = false;
  return pluginRegister.call(this, user, password, saveOptions);
};

UserSchema.statics.findByAuthToken = function (authToken) {
  return this.findOne({ authToken: authToken });
};

// resolves with the user, or with false when the token is unknown
UserSchema.statics.verifyEmail = async function (authToken) {
  const user = await this.findByAuthToken(authToken);
  if (!user) {
    return false;
  }
  user.isAuthenticated = true;
  await user.save();
  return user;
};

// unverified users cannot log in (used by createStrategy())
UserSchema.statics.authenticate = function () {
  const self = this;
  const inner = pluginAuthenticate.call(this);
  const authenticate = async function (username, password) {
    const user = await self.findByUsername(username);
    if (user && !user.isAuthenticated) {
      return { user: false, error: new Error('User did not verify email!') };
    }
    return inner(username, password);
  };
  // passport-local expects a node-style callback, so bridge when one is given
  return function (username, password, cb) {
    const promise = authenticate(username, password);
    if (!cb) {
      return promise;
    }
    promise.then(
      function (result) {
        cb(null, result.user, result.error);
      },
      function (error) {
        cb(error);
      }
    );
  };
};

module.exports = mongoose.model('User', UserSchema);
