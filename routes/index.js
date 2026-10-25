const express = require('express'),
  passport = require('passport');
const User = require('../models/user');
const ValidatedUser = require('../models/validatedUser');
const nodemailer = require('nodemailer');
const config = require('../config');
const middleware = require('../middleware');
const dashboard = require('../services/dashboard');
const transporter = nodemailer.createTransport(config.smtp);

const mailOptions = {
  from: config.mail.from,
  to: config.mail.to,
  subject: config.mail.subject,
};

const router = express.Router();

// e-mails the account activation link; never rejects
async function sendVerificationMail(user) {
  const authenticationURL =
    'http://' + config.ip + ':' + config.port + '/verify?authToken=' + user.authToken;
  mailOptions.text =
    'Hi, you have signed for access to Network Inventory, please activate it by clicking on the following URL:\n' +
    authenticationURL;
  try {
    await transporter.sendMail(mailOptions);
  } catch (error) {
    console.log(error);
  }
}
//add routes
// dashboard: inventory counts, sync / import status, recent activity
router.get('/home', middleware.isLoggedIn, async function (request, response) {
  response.render('home', { dashboard: await dashboard.summary() });
});
router.get('/', function (request, response) {
  response.render('landing');
});
//PASS environment parameters
router.get('/getenv', function (req, res) {
  res.json({ ip: config.ip, port: config.port });
});
//======================
// AUTH ROUTES
//======================
//show register Form
router.get('/signup', function (request, response) {
  response.render('signup', { form: {} });
});

const PASSWORD_MIN_LENGTH = 6;

/** signup form problems (the view re-renders with them); empty = ok */
function validateSignup(form) {
  const errors = [];
  if (!form.name) errors.push('Name is required');
  if (!form.email || !ValidatedUser.EMAIL_PATTERN.test(form.email))
    errors.push('A valid e-mail address is required');
  if (!form.password || form.password.length < PASSWORD_MIN_LENGTH)
    errors.push('The password must have at least ' + PASSWORD_MIN_LENGTH + ' characters');
  return errors;
}

//handle signup logic
router.post('/signup', async function (request, response) {
  const form = {
    name: String(request.body.name || '').trim(),
    email: String(request.body.email || '')
      .trim()
      .toLowerCase(),
    password: typeof request.body.password === 'string' ? request.body.password : '',
  };
  const errors = validateSignup(form);
  if (errors.length) {
    // the form is re-rendered straight away, so the messages are passed explicitly
    return response.render('signup', {
      error: errors,
      form: { name: form.name, email: form.email },
    });
  }
  const newUser = new User({ name: form.name, email: form.email });
  const foundUser = await ValidatedUser.findOne({ email: form.email });
  if (foundUser == null) {
    request.flash('error', 'User not allowed');
    return response.render('email-error', { email: form.email });
  }
  // the role granted on the whitelist entry (admin | operator) is the user's role
  newUser.role = foundUser.role || 'admin';
  let user;
  try {
    user = await User.register(newUser, form.password);
  } catch (error) {
    return response.render('signup', {
      error: [error.message],
      form: { name: form.name, email: form.email },
    });
  }
  //send email verification (in the background)
  sendVerificationMail(user);
  response.redirect('/email-verification');
});

router.get('/email-verification', function (request, response) {
  response.render('email-verification', {
    title: 'E-mail verification sent',
    message:
      'Check your mailbox for the activation link. Until the e-mail is verified the account cannot log in.',
  });
});

router.get('/verify', async function (request, response) {
  const user = await User.verifyEmail(request.query.authToken);
  if (!user) {
    return response.status(404).render('email-verification', {
      title: 'Unknown verification link',
      message:
        'This verification link is not valid (any more). Sign up again to receive a new one.',
      failed: true,
    });
  }
  response.render('email-verification', {
    title: 'E-mail verified successfully',
    message: 'Your account ' + user.email + ' is active: you can log in now.',
  });
});

//show login form
router.get('/login', function (request, response) {
  response.render('login');
});

// handling login logic
router.post(
  '/login',
  passport.authenticate('local', {
    successRedirect: '/home',
    failureRedirect: '/login',
    failureFlash: true, // the strategy's message (wrong password, e-mail not verified, ...)
  })
);

//logout ROUTE
router.get('/logout', function (request, response, next) {
  // passport >= 0.6 requires a callback (the session is regenerated)
  request.logout(function (error) {
    if (error) {
      return next(error);
    }
    request.flash('success', 'logged you out');
    response.redirect('/login');
  });
});

//show change password form
router.get('/changepass', function (request, response) {
  response.render('changepassword');
});

router.post('/changepass', function (request, response) {
  if (request.body.newpass !== request.body.newpassconfirm) {
    request.flash('error', 'password and confirm password do not match');
    return response.redirect('/changepass');
  }
  // Changing the password is not available: this form is unauthenticated
  // (anyone could reset any account by e-mail) and the original handler never
  // worked. The user is told so instead of getting a server error.
  request.flash('error', 'password change is not available');
  response.redirect('/changepass');
});

module.exports = router;
