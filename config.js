/**
 * Central, dotenv-based configuration.
 *
 * Loads `.env` (if present; real environment variables always win) and
 * exposes one normalized object so no other module reads process.env.
 * See .env.example for the list of variables.
 */
const net = require('net');
const path = require('path');

// DOTENV_CONFIG_PATH can point elsewhere (the test-suite points it at a
// non-existent file so a developer's .env never leaks into the tests)
require('dotenv').config({
  path: process.env.DOTENV_CONFIG_PATH || path.join(__dirname, '.env'),
  quiet: true,
});

const env = process.env;

function required(name) {
  const value = env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable ${name} (see .env.example)`);
  }
  return value;
}

/**
 * Validates a MongoDB connection string early, with a readable message
 * (e.g. a malformed IPv4 like "127.0.01" would otherwise surface 30s later as
 * an ECONNREFUSED from the driver).
 */
function validateMongoUrl(url) {
  const match = /^(mongodb(?:\+srv)?):\/\/(?:[^@/]*@)?([^/?]+)/.exec(url);
  if (!match) {
    throw new Error(
      `MONGO_URL "${url}" is not a valid MongoDB connection string (expected mongodb://host[:port]/db)`
    );
  }
  for (const hostPort of match[2].split(',')) {
    const host = hostPort.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    if (/^[\d.]+$/.test(host) && net.isIPv4(host) === false) {
      throw new Error(
        `MONGO_URL host "${host}" is not a valid IPv4 address (did you mean 127.0.0.1?)`
      );
    }
    if (host === '') {
      throw new Error(`MONGO_URL "${url}" has an empty host`);
    }
  }
  return url;
}

/** connection string without credentials, for log messages */
function redactMongoUrl(url) {
  return url.replace(/^(mongodb(?:\+srv)?:\/\/)[^@/]*@/, '$1***@');
}

function embeddedMongoMode() {
  const requested = (env.EMBEDDED_MONGO || 'auto').toLowerCase();
  if (!['auto', 'never', 'always'].includes(requested)) {
    throw new Error(
      `EMBEDDED_MONGO must be one of auto, never, always (got "${env.EMBEDDED_MONGO}")`
    );
  }
  if (requested === 'auto' && (env.MONGO_URL || env.NODE_ENV === 'production')) {
    return 'never';
  }
  return requested;
}

const dbName = env.DEV_DB || 'network-inventory';

const config = {
  nodeEnv: env.NODE_ENV || 'development',
  isTest: env.NODE_ENV === 'test',

  // HTTP server
  ip: env.IP || '127.0.0.1',
  port: env.PORT || '8080',

  // express-session secret (required; the app refuses to start without it)
  sessionSecret: required('SESSION_SECRET'),

  // MongoDB (application data + sessions)
  dbName,
  mongoUrl: validateMongoUrl(env.MONGO_URL || `mongodb://localhost/${dbName}`),
  // how long to wait for MongoDB at startup before giving up
  mongoConnectTimeoutMs: Number(env.MONGO_CONNECT_TIMEOUT_MS || 10000),
  // embedded MongoDB fallback for development (services/database.js):
  //   auto   - used only when MONGO_URL is unset, nothing answers at the default
  //            URL and NODE_ENV is not 'production' (default)
  //   never  - always require the configured server
  //   always - do not even try the configured server
  embeddedMongo: {
    mode: embeddedMongoMode(),
    dbPath: env.EMBEDDED_MONGO_PATH || path.join(__dirname, 'data', 'db'),
  },

  // behavior switches
  seed: env.SEED === 'true',
  isWindows: env.OS === 'WIN',

  // SNMP discovery
  snmp: {
    // community used when a device is created without one
    // (DEFAULT_SMP_COMMUNITY is accepted as an alias of DEFAULT_SNMP_COMMUNITY)
    defaultCommunity: env.DEFAULT_SNMP_COMMUNITY || env.DEFAULT_SMP_COMMUNITY || 'public',
    timeoutMs: Number(env.SNMP_TIMEOUT_MS || 10000),
    maxRepetitions: Number(env.SNMP_MAX_REPETITIONS || 20),
  },

  // automatic device sync (cron pattern: sec min hour day month weekday)
  sync: {
    cron: env.SYNC_CRON || '0 0 0 */2 * *',
    timezone: env.SYNC_TIMEZONE || 'Europe/Dublin',
  },

  // administrator account ensured at startup (services/adminAccount.js); optional
  admin: {
    email: env.ADMIN_EMAIL,
    password: env.ADMIN_PASSWORD,
    name: env.ADMIN_NAME || 'Administrator',
  },

  // e-mail (account verification); no defaults for hosts or credentials
  smtp: {
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT || 25),
    secure: env.SMTP_SECURE === 'true', // upgrade later with STARTTLS
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  },
  mail: {
    from: env.MAIL_FROM,
    to: env.MAIL_TO,
    subject: env.MAIL_SUBJECT || 'Activate your Network Inventory account',
  },
};

config.redactMongoUrl = redactMongoUrl;

module.exports = config;
