const path = require('path');
const { spawnSync } = require('child_process');

if (process.platform === 'win32') {
  console.log('fetch-mongod: skipping shim on Windows (mongodb-memory-server downloads mongod)');
  process.exit(0);
}

const result = spawnSync('bash', [path.join(__dirname, 'fetch-mongod.sh')], {
  stdio: 'inherit',
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
