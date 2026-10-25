/**
 * Starts a single in-memory MongoDB (mongodb-memory-server) for the whole
 * jest run.
 *
 * 1. application.js hard-codes its connection string to
 *    "mongodb://localhost/" + process.env.DEV_DB (i.e. the default port
 *    27017), so the in-memory server is pinned to port 27017 instead of a
 *    random free port.
 *
 * 2. If scripts/fetch-mongod.sh has provisioned a binary (this sandbox cannot
 *    reach fastdl.mongodb.org, memory-server's download host) it is used via
 *    MONGOMS_SYSTEM_BINARY; otherwise memory-server downloads a real mongod as
 *    usual. The provisioned binary is a mongo-java-server based in-memory
 *    MongoDB emulation advertising MongoDB 5.0 (see scripts/mongod-shim).
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

module.exports = async function globalSetup() {
  const binary = path.join(__dirname, '..', '.cache', 'mongod', 'mongod');

  if (
    process.platform !== 'win32' &&
    !process.env.MONGOMS_SYSTEM_BINARY &&
    !process.env.MONGOMS_USE_DOWNLOAD
  ) {
    if (!fs.existsSync(binary)) {
      execFileSync('bash', [path.join(__dirname, '..', 'scripts', 'fetch-mongod.sh')], {
        stdio: 'inherit',
      });
    }
    if (fs.existsSync(binary)) {
      process.env.MONGOMS_SYSTEM_BINARY = binary;
      process.env.MONGOMS_VERSION = process.env.MONGOMS_VERSION || '5.0.0';
    }
  }

  const { MongoMemoryServer } = require('mongodb-memory-server');
  global.__MONGOD__ = await MongoMemoryServer.create({
    instance: {
      ip: '127.0.0.1',
      port: 27017, // see note (1) above
      storageEngine: 'ephemeralForTest', // in-memory storage engine (ignored by the shim)
    },
  });
};
