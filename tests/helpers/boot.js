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

async function bootApp() {
  const port = await getFreePort();

  process.env.SECRET = process.env.SECRET || 'test-secret';
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
      Governorate: mongoose.model('Governorate'),
      Link: mongoose.model('Link'),
      Enrichment: mongoose.model('Enrichment'),
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
async function signupVerifiedUser(app, { name, email, password }) {
  await app.models.ValidatedUser.create({ name, email, role: 'admin' });
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

/** signup + verify + login in one go */
async function authedAgent(app, creds) {
  const defaults = { name: 'Test User', email: 'tester@example.com', password: 'secret123' };
  const user = Object.assign(defaults, creds || {});
  const dbUser = await signupVerifiedUser(app, user);
  const agent = await loginAgent(app, user);
  return { agent, user: dbUser, creds: user };
}

module.exports = { bootApp, authedAgent, signupVerifiedUser, loginAgent, sleep };
