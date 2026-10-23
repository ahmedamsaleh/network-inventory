//require
const express = require('express'),
  mongoose = require('mongoose'),
  flash = require('connect-flash'),
  passport = require('passport'),
  methodOverride = require('method-override'),
  config = require('./config'),
  User = require('./models/user'),
  logger = require('./middleware/logger'); //logging component
// deleteLogger           = require('./middleware/deleteLogger'),//logging component
const fileUpload = require('express-fileupload');
const MongoStore = require('connect-mongo').MongoStore;

const CronJob = require('cron').CronJob;

//requiring routes
const interfaceRoutes = require('./routes/interfaces'),
  popRoutes = require('./routes/pops'),
  sectorRoutes = require('./routes/sectors'),
  governorateRoutes = require('./routes/governorates'),
  linkRoutes = require('./routes/links'),
  userRoutes = require('./routes/users'),
  validatedUserRoutes = require('./routes/validatedUsers'),
  deviceRoutes = require('./routes/devices'),
  enrichmentRoutes = require('./routes/enrichments'),
  indexRoutes = require('./routes/index');

const indexBaseURL = '/',
  popBaseURL = '/pops',
  sectorBaseURL = '/sectors',
  governorateBaseURL = '/governorates',
  linkBaseURL = '/links',
  userBaseURL = '/users',
  validatedUserBaseURL = '/validatedusers',
  deviceBaseURL = '/devices',
  enrichmentBaseURL = '/enrichments',
  interfaceBaseURL = '/interfaces';
// interfaceBaseURL      = "/devices/:id/interfaces";

const applicationVersion = 1;

//inistantiate app
const app = express();
app.set('view engine', 'ejs');
// Express 5 defaults to the "simple" query parser; keep Express 4's extended
// (qs) parsing so nested query strings keep working as before.
app.set('query parser', 'extended');
app.use(express.static(__dirname + '/public'));
app.use(methodOverride('_method'));
app.use(flash());

app.use(express.urlencoded({ extended: true }));
mongoose.connect(config.mongoUrl).catch(function (error) {
  logger.error(error);
});
//seedDB();

//Passport configuration
// sessions are persisted in MongoDB (collection "sessions" of the app database),
// sharing the mongoose connection, so logins survive restarts.
app.use(
  require('express-session')({
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      clientPromise: mongoose.connection.asPromise().then(function (connection) {
        return connection.getClient();
      }),
    }),
  })
);
app.use(fileUpload());
app.use(passport.initialize());
app.use(passport.session());
passport.use(User.createStrategy());
passport.serializeUser(User.serializeUser()); //read the session, take the data from the session and encode it, serialze it and put it back in the session
passport.deserializeUser(User.deserializeUser()); //read the session, taking the data from the session that's encoded and decode it

//run this middleware for every single route, it passes the current user to the route
//it must be after passport initialization
app.use(function (request, response, next) {
  response.locals.currentUser = request.user;
  response.locals.error = request.flash('error');
  response.locals.success = request.flash('success');
  response.locals.warning = request.flash('warning');
  next();
});

app.use(indexBaseURL, indexRoutes);
app.use(deviceBaseURL, deviceRoutes);
app.use(interfaceBaseURL, interfaceRoutes);
app.use(popBaseURL, popRoutes);
app.use(sectorBaseURL, sectorRoutes);
app.use(governorateBaseURL, governorateRoutes);
app.use(userBaseURL, userRoutes);
app.use(linkBaseURL, linkRoutes);
app.use(validatedUserBaseURL, validatedUserRoutes);
app.use(enrichmentBaseURL, enrichmentRoutes);

// central error handler: everything passed to next(error) or thrown/rejected
// inside a route handler ends up here (Express 5 forwards rejected promises).
app.use(function (error, request, response, next) {
  logger.error(error);
  if (response.headersSent) {
    return next(error);
  }
  const status = error.status || error.statusCode || 500;
  response.status(status);
  response.type('text/plain');
  if (status >= 500 && config.nodeEnv === 'production') {
    return response.send('Internal Server Error');
  }
  response.send(error.stack || String(error));
});

//start server
process.on('uncaughtException', function (err) {
  logger.error(err);
  console.log('Node NOT Exiting...');
});

//sec min hour day month weekday
new CronJob(
  config.sync.cron,
  function () {
    console.log('Automatic sync for devices runs every 48 hrs');
    console.log('current syncing time is: ' + new Date());
    deviceRoutes.syncDevices();
  },
  null,
  true,
  config.sync.timezone
);

logger.info('new message');
// deleteLogger.delete("device deleted");

app.listen(config.port, config.ip, function () {
  console.log(
    'Network Inventory V' +
      applicationVersion +
      ' Server Started on ' +
      config.ip +
      ':' +
      config.port
  );
  console.log('current time is: ' + new Date());
});
