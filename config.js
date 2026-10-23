/**
 * Central, dotenv-based configuration.
 *
 * Loads `.env` (if present; real environment variables always win) and
 * exposes one normalized object so no other module reads process.env.
 * See .env.example for the list of variables.
 */
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });

const env = process.env;

function required(name) {
  const value = env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable ${name} (see .env.example)`);
  }
  return value;
}

const dbName = env.DEV_DB || 'network-inventory';

const config = {
  nodeEnv: env.NODE_ENV || 'development',
  isTest: env.NODE_ENV === 'test',

  // HTTP server
  ip: env.IP || '127.0.0.1',
  port: env.PORT || '8080',

  // express-session secret
  secret: required('SECRET'),

  // MongoDB (application data + sessions)
  dbName,
  mongoUrl: env.MONGO_URL || `mongodb://localhost/${dbName}`,

  // behavior switches
  seed: env.SEED === 'true',
  isWindows: env.OS === 'WIN',

  // SNMP discovery
  snmp: {
    defaultCommunity: env.SNMP_COMMUNITY || '<DEFAULT_COMMUNITY_STRING>',
    timeoutMs: Number(env.SNMP_TIMEOUT_MS || 10000),
    maxRepetitions: Number(env.SNMP_MAX_REPETITIONS || 20),
  },

  // automatic device sync (cron pattern: sec min hour day month weekday)
  sync: {
    cron: env.SYNC_CRON || '0 0 0 */2 * *',
    timezone: env.SYNC_TIMEZONE || 'Africa/Cairo',
  },

  // e-mail (account verification)
  smtp: {
    host: env.SMTP_HOST || '<HOST>',
    port: Number(env.SMTP_PORT || 25),
    secure: env.SMTP_SECURE === 'true', // upgrade later with STARTTLS
    auth: {
      user: env.SMTP_USER || '<USER>@<DOMAIN>',
      pass: env.SMTP_PASS || '<yourpassword>',
    },
  },
  mail: {
    from: env.MAIL_FROM || '<SENDER>@<DOMAIN>',
    to: env.MAIL_TO || '<RECIPIENT>@<DOMAIN>',
    subject: env.MAIL_SUBJECT || 'Activate your Network Inventory account',
  },
};

module.exports = config;
