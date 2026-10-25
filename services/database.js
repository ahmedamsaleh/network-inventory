/**
 * MongoDB connection for the application.
 *
 * connect() opens the configured connection (config.mongoUrl). When no
 * MONGO_URL is configured, nothing listens on the default localhost URL and the
 * app does not run in production, it falls back to an embedded MongoDB
 * (mongodb-memory-server) so `npm start` works on a plain development machine.
 * The embedded server keeps its data in ./data/db when a real mongod binary is
 * used (the in-memory test shim does not persist).
 */
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const config = require('../config');
const logger = require('../middleware/logger');

let embeddedServer = null;

async function startEmbeddedMongo() {
  let MongoMemoryServer;
  try {
    ({ MongoMemoryServer } = require('mongodb-memory-server'));
  } catch {
    throw new Error(
      'embedded MongoDB is not available (mongodb-memory-server is a devDependency: run `npm install`)'
    );
  }
  // test-harness shim provisioned by scripts/fetch-mongod.sh (environments that cannot download mongod)
  const shim = path.join(__dirname, '..', '.cache', 'mongod', 'mongod');
  if (!process.env.MONGOMS_SYSTEM_BINARY && fs.existsSync(shim)) {
    process.env.MONGOMS_SYSTEM_BINARY = shim;
    process.env.MONGOMS_VERSION = process.env.MONGOMS_VERSION || '5.0.0';
  }
  const persistent = !process.env.MONGOMS_SYSTEM_BINARY;
  const instance = { ip: '127.0.0.1' };
  if (persistent) {
    fs.mkdirSync(config.embeddedMongo.dbPath, { recursive: true });
    instance.dbPath = config.embeddedMongo.dbPath;
    instance.storageEngine = 'wiredTiger';
  }
  embeddedServer = await MongoMemoryServer.create({ instance });
  return {
    uri: embeddedServer.getUri(config.dbName),
    persistent,
  };
}

/**
 * Connects mongoose and resolves with the underlying MongoClient (used by the
 * session store). Rejects with a descriptive error when no database is usable.
 */
async function connect() {
  const options = { serverSelectionTimeoutMS: config.mongoConnectTimeoutMs };
  const primaryUrl = config.mongoUrl;
  try {
    if (config.embeddedMongo.mode !== 'always') {
      // when a fallback exists, do not make developers wait the full timeout
      const probeTimeout =
        config.embeddedMongo.mode === 'auto'
          ? Math.min(config.mongoConnectTimeoutMs, 3000)
          : config.mongoConnectTimeoutMs;
      await mongoose.connect(primaryUrl, { serverSelectionTimeoutMS: probeTimeout });
      logger.info('connected to MongoDB at ' + config.redactMongoUrl(primaryUrl));
      return mongoose.connection.getClient();
    }
  } catch (error) {
    if (config.embeddedMongo.mode === 'never') {
      throw new Error(
        'Cannot connect to MongoDB at ' +
          config.redactMongoUrl(primaryUrl) +
          ' (' +
          error.message +
          '). Check MONGO_URL / DEV_DB and that MongoDB is running.',
        { cause: error }
      );
    }
    logger.warn(
      'No MongoDB reachable at ' +
        config.redactMongoUrl(primaryUrl) +
        ' (' +
        error.message +
        ') - starting an embedded MongoDB for development. ' +
        'Set MONGO_URL to use a real server (EMBEDDED_MONGO=never disables this fallback).'
    );
  }
  const embedded = await startEmbeddedMongo();
  await mongoose.connect(embedded.uri, options);
  logger.warn(
    'using embedded MongoDB at ' +
      embedded.uri +
      (embedded.persistent
        ? ' (data in ' + config.embeddedMongo.dbPath + ')'
        : ' (IN-MEMORY: data is lost on restart)')
  );
  return mongoose.connection.getClient();
}

async function disconnect() {
  await mongoose.disconnect();
  if (embeddedServer) {
    await embeddedServer.stop();
    embeddedServer = null;
  }
}

module.exports = { connect, disconnect };
