/**
 * config.js validation (no database needed).
 */
const path = require('path');

function loadConfig(envOverrides) {
  const saved = { ...process.env };
  for (const key of [
    'SESSION_SECRET',
    'MONGO_URL',
    'DEV_DB',
    'MONGO_CONNECT_TIMEOUT_MS',
    'EMBEDDED_MONGO',
    'NODE_ENV',
  ]) {
    delete process.env[key];
  }
  process.env.DOTENV_CONFIG_PATH = path.join(__dirname, 'no-such.env'); // ignore any local .env
  Object.assign(process.env, envOverrides);
  let result;
  jest.isolateModules(() => {
    result = require('../config');
  });
  process.env = saved;
  return result;
}

describe('config', () => {
  test('fails fast without SESSION_SECRET', () => {
    expect(() => loadConfig({})).toThrow(/SESSION_SECRET/);
  });

  test('defaults the MongoDB URL to localhost/DEV_DB', () => {
    const config = loadConfig({ SESSION_SECRET: 's', DEV_DB: 'inventory' });
    expect(config.mongoUrl).toBe('mongodb://localhost/inventory');
    expect(config.mongoConnectTimeoutMs).toBe(10000);
  });

  test('accepts valid MONGO_URL values (IP, hostname, replica set, srv, credentials)', () => {
    for (const url of [
      'mongodb://127.0.0.1:27017/db',
      'mongodb://mongo/db',
      'mongodb://a:27017,b:27018/db?replicaSet=rs0',
      'mongodb+srv://cluster.example.com/db',
      'mongodb://user:pw@10.0.0.5:27017/db?authSource=admin',
      'mongodb://[::1]:27017/db',
    ]) {
      expect(loadConfig({ SESSION_SECRET: 's', MONGO_URL: url }).mongoUrl).toBe(url);
    }
  });

  test('rejects a malformed IPv4 host with a hint', () => {
    expect(() =>
      loadConfig({ SESSION_SECRET: 's', MONGO_URL: 'mongodb://127.0.01:27017/db' })
    ).toThrow(/"127.0.01" is not a valid IPv4 address \(did you mean 127.0.0.1\?\)/);
  });

  test('rejects strings that are not MongoDB connection strings', () => {
    expect(() => loadConfig({ SESSION_SECRET: 's', MONGO_URL: '127.0.0.1:27017' })).toThrow(
      /not a valid MongoDB connection string/
    );
    expect(() => loadConfig({ SESSION_SECRET: 's', MONGO_URL: 'mongodb:///db' })).toThrow(
      /not a valid MongoDB connection string/
    );
  });

  test('embedded MongoDB fallback: auto in development, never with MONGO_URL or in production', () => {
    expect(loadConfig({ SESSION_SECRET: 's' }).embeddedMongo.mode).toBe('auto');
    expect(
      loadConfig({ SESSION_SECRET: 's', MONGO_URL: 'mongodb://db/x' }).embeddedMongo.mode
    ).toBe('never');
    expect(loadConfig({ SESSION_SECRET: 's', NODE_ENV: 'production' }).embeddedMongo.mode).toBe(
      'never'
    );
    expect(loadConfig({ SESSION_SECRET: 's', EMBEDDED_MONGO: 'always' }).embeddedMongo.mode).toBe(
      'always'
    );
    expect(() => loadConfig({ SESSION_SECRET: 's', EMBEDDED_MONGO: 'maybe' })).toThrow(
      /EMBEDDED_MONGO/
    );
  });

  test('redactMongoUrl hides credentials', () => {
    const config = loadConfig({ SESSION_SECRET: 's' });
    expect(config.redactMongoUrl('mongodb://user:pw@host/db')).toBe('mongodb://***@host/db');
    expect(config.redactMongoUrl('mongodb://host/db')).toBe('mongodb://host/db');
  });
});
