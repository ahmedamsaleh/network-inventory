//require
const express = require('express'),
  flash = require('connect-flash'),
  passport = require('passport'),
  methodOverride = require('method-override');

// configuration problems are reported as one readable line, not a stack trace
let config;
try {
  config = require('./config');
} catch (error) {
  console.error('Configuration error: ' + error.message);
  process.exit(1);
}

const User = require('./models/user'),
  logger = require('./middleware/logger'); //logging component
// deleteLogger           = require('./middleware/deleteLogger'),//logging component
const database = require('./services/database');
const adminAccount = require('./services/adminAccount');
const fileUpload = require('express-fileupload');
const MongoStore = require('connect-mongo').MongoStore;

const CronJob = require('cron').CronJob;

//requiring routes
const interfaceRoutes = require('./routes/interfaces'),
  popRoutes = require('./routes/pops'),
  sectorRoutes = require('./routes/sectors'),
  countyRoutes = require('./routes/counties'),
  linkRoutes = require('./routes/links'),
  userRoutes = require('./routes/users'),
  validatedUserRoutes = require('./routes/validatedUsers'),
  deviceRoutes = require('./routes/devices'),
  enrichmentRoutes = require('./routes/enrichments'),
  indexRoutes = require('./routes/index');

const indexBaseURL = '/',
  popBaseURL = '/pops',
  sectorBaseURL = '/sectors',
  countyBaseURL = '/counties',
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
// Connect to MongoDB first; the HTTP server only starts once the database is
// reachable (see start() at the bottom). A failed connection ends the process
// with a clear message instead of an unhandled rejection 30 seconds later.
const databaseReady = database.connect();
// the rejection is handled in start(); this only keeps Node from reporting it
databaseReady.catch(function () {});
//seedDB();

//Passport configuration
// sessions are persisted in MongoDB (collection "sessions" of the app database),
// sharing the mongoose connection, so logins survive restarts.
app.use(
  require('express-session')({
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ clientPromise: databaseReady }),
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
app.use(countyBaseURL, countyRoutes);
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

async function start() {
  try {
    await databaseReady;
  } catch (error) {
    logger.error(error.message);
    process.exit(1);
  }
  try {
    await adminAccount.ensureAdminAccount();
  } catch (error) {
    logger.error('could not ensure the admin account: ' + error.message);
  }
  const server = app.listen(config.port, config.ip, function () {
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

  // graceful shutdown: stop accepting requests, close the database (and the
  // embedded MongoDB, if one was started), then exit
  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('received ' + signal + ', shutting down');
    server.close();
    try {
      await database.disconnect();
    } catch (error) {
      logger.error(error);
    }
    process.exit(0);
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start();
