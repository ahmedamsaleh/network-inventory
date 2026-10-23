const express = require('express'),
  passport = require('passport');
const User = require('../models/user');
const ValidatedUser = require('../models/validatedUser');
const nodemailer = require('nodemailer');
const config = require('../config');
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
router.get('/home', function (request, response) {
  response.render('home');
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
  response.render('signup');
});
//handle signup logic
router.post('/signup', async function (request, response) {
  const newUser = new User({ name: request.body.name, email: request.body.email });
  let foundUser;
  try {
    foundUser = await ValidatedUser.findOne({ email: request.body.email });
  } catch (error) {
    request.flash('error', error);
    return response.render('signup');
  }
  if (foundUser == null) {
    request.flash('error', 'User not allowed');
    return response.render('email-error');
  }
  let user;
  try {
    user = await User.register(newUser, request.body.password);
  } catch (error) {
    request.flash('error', error.message);
    return response.render('signup');
  }
  //send email verification (in the background)
  sendVerificationMail(user);
  response.redirect('/email-verification');
});

router.get('/email-verification', function (request, response) {
  response.render('email-verification', { title: 'Email verification sent!' });
});

router.get('/verify', async function (request, response) {
  try {
    await User.verifyEmail(request.query.authToken);
  } catch (error) {
    console.log('error:', error);
    return;
  }
  response.render('email-verification', { title: 'Email verified succesfully!' });
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

router.post('/changepass', async function (request, res, next) {
  if (request.body.newpass !== request.body.newpassconfirm) {
    throw new Error('password and confirm password do not match');
  }

  // Changing the password is not available: this form is unauthenticated
  // (anyone could reset any account by e-mail) and the original handler
  // never worked (it referenced an undefined variable and always failed).
  // Kept as an explicit error so the behavior (HTTP 500) is unchanged.
  throw new Error('password change is not available');
});

module.exports = router;
