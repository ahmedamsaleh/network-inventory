/**
 * Boots the real application (application.js) once per test file and returns
 * handles for driving it with supertest.
 *
 * application.js neither exports the express app nor the http server - it
 * calls app.listen() itself at require time. To avoid changing application
 * code we:
 *   - wrap express.application.listen before requiring application.js so we
 *     can capture the http.Server (needed to close it in afterAll), and
 *   - run supertest against the listening server's URL.
 *
 * Each test file gets its own database name (application.js connects to
 * "mongodb://localhost/" + DEV_DB) so files never see each other's data.
 */
const net = require('net');
const path = require('path');
const request = require('supertest');

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

function waitFor(fn, timeoutMs, what) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (function poll() {
      if (fn()) return resolve();
      if (Date.now() - start > timeoutMs) {
        return reject(new Error('Timed out waiting for ' + what));
      }
      setTimeout(poll, 50);
    })();
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** credentials of the admin account the app creates at startup */
const ADMIN = { email: 'admin@example.com', password: 'admin-test-password' };

async function bootApp() {
  const port = await getFreePort();

  // never load a developer's .env into the tests
  process.env.DOTENV_CONFIG_PATH = path.join(__dirname, 'no-such.env');
  delete process.env.MONGO_URL;
  delete process.env.EMBEDDED_MONGO;
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret';
  // administrator account ensured by the app at startup (services/adminAccount.js)
  process.env.ADMIN_EMAIL = ADMIN.email;
  process.env.ADMIN_PASSWORD = ADMIN.password;
  // keep background SNMP discovery of fake devices short during the tests
  process.env.SNMP_TIMEOUT_MS = process.env.SNMP_TIMEOUT_MS || '500';
  process.env.SNMP_RETRIES = process.env.SNMP_RETRIES || '0';
  // IIB community rule fixtures (tests/sync.test.js)
  process.env.API_KEY = 'test-api-key';
  process.env.COMMUNITY_KEY1 = 'iib-placeholder';
  process.env.COMMUNITY_VALUE1 = 'real-secret-community';
  process.env.IP = '127.0.0.1';
  process.env.PORT = String(port);
  process.env.DEV_DB =
    'test_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1e9).toString(36);
  delete process.env.SEED; // make sure seeds.js is never triggered

  // Capture the http.Server created inside application.js.
  const express = require('express');
  const origListen = express.application.listen;
  let server;
  express.application.listen = function (...args) {
    server = origListen.apply(this, args);
    return server;
  };
  try {
    require(path.join(__dirname, '..', '..', 'application.js'));
  } finally {
    express.application.listen = origListen;
  }

  const mongoose = require('mongoose');
  await waitFor(() => server && server.listening, 15000, 'http server to listen');
  await waitFor(() => mongoose.connection.readyState === 1, 15000, 'mongoose connection');

  const baseUrl = 'http://127.0.0.1:' + port;

  const app = {
    baseUrl,
    server,
    mongoose,
    models: {
      User: mongoose.model('User'),
      ValidatedUser: mongoose.model('ValidatedUser'),
      Device: mongoose.model('Device'),
      Interface: mongoose.model('Interface'),
      POP: mongoose.model('POP'),
      Sector: mongoose.model('Sector'),
      County: mongoose.model('County'),
      Link: mongoose.model('Link'),
      Enrichment: mongoose.model('Enrichment'),
      RawInterface: mongoose.model('RawInterface'),
      Cabinet: mongoose.model('Cabinet'),
      DeviceModel: mongoose.model('DeviceModel'),
      BTMSANInfo: mongoose.model('BTMSANInfo'),
      AuditLog: mongoose.model('AuditLog'),
      ArchivedInterface: mongoose.model('ArchivedInterface'),
    },
    /** anonymous (cookie-less) client */
    anon: () => request(baseUrl),
    /** cookie-keeping client */
    agent: () => request.agent(baseUrl),
    close: async () => {
      await new Promise((resolve) => {
        server.close(resolve);
        // Several routes never answer on their error paths (see
        // TESTING-NOTES.md); any request stuck that way would otherwise keep
        // server.close() from ever finishing.
        if (typeof server.closeAllConnections === 'function') {
          server.closeAllConnections();
        }
      });
      await mongoose.disconnect();
    },
  };
  return app;
}

/**
 * Creates a user through the real signup flow (whitelist in ValidatedUser,
 * POST /signup, then e-mail verification via the authToken stored on the
 * user document) and returns a logged-in supertest agent.
 */
async function signupVerifiedUser(app, { name, email, password, role }) {
  await app.models.ValidatedUser.create({ name, email, role: role || 'admin' });
  await app
    .anon()
    .post('/signup')
    .type('form')
    .send({ name, email, password })
    .expect(302)
    .expect('location', '/email-verification');
  const user = await app.models.User.findOne({ email });
  if (!user) throw new Error('signup did not create user ' + email);
  await app.anon().get('/verify').query({ authToken: user.authToken }).expect(200);
  return app.models.User.findOne({ email }); // re-fetch post-verification state
}

async function loginAgent(app, { email, password }) {
  const agent = app.agent();
  await agent
    .post('/login')
    .type('form')
    .send({ email, password })
    .expect(302)
    .expect('location', '/home');
  return agent;
}

/** logged-in supertest agent for the startup-created admin account */
async function adminAgent(app) {
  return loginAgent(app, ADMIN);
}

/** signup + verify + login in one go */
async function authedAgent(app, creds) {
  const defaults = { name: 'Test User', email: 'tester@example.com', password: 'secret123' };
  const user = Object.assign(defaults, creds || {});
  const dbUser = await signupVerifiedUser(app, user);
  const agent = await loginAgent(app, user);
  return { agent, user: dbUser, creds: user };
}

/** signup + verify + login of a user whitelisted with the "operator" role */
async function operatorAgent(app, creds) {
  return authedAgent(
    app,
    Object.assign(
      {
        name: 'Operator',
        email: 'operator@example.com',
        password: 'operator123',
        role: 'operator',
      },
      creds || {}
    )
  );
}

module.exports = {
  bootApp,
  authedAgent,
  adminAgent,
  operatorAgent,
  signupVerifiedUser,
  loginAgent,
  sleep,
  ADMIN,
};
