/**
 * Runs services/syncDevice over many devices with bounded concurrency
 * (p-limit, SYNC_CONCURRENCY). A failing device never stops the cycle: every
 * device yields a result object and the run reports them all. Runs started
 * with start()/startAll() execute in the background; status() exposes the
 * current and the last run.
 */
const pLimit = require('p-limit');
const config = require('../config');
const logger = require('../middleware/logger');
const Device = require('../models/device');
const { syncDevice } = require('./syncDevice');

let currentRun = null;
let lastRun = null;

/**
 * @param {object[]} devices
 * @param {object} [options] { concurrency, createSession, now, cyclesThreshold }
 * @returns {Promise<object>} { startedAt, finishedAt, durationMs, total, ok, failed, results }
 */
async function syncDevices(devices, options = {}) {
  const concurrency = Math.max(1, Number(options.concurrency || config.sync.concurrency) || 1);
  const limit = pLimit(concurrency);
  const startedAt = new Date();
  const run = {
    startedAt,
    finishedAt: null,
    durationMs: 0,
    total: devices.length,
    ok: 0,
    failed: 0,
    results: [],
  };
  const results = await Promise.all(
    devices.map((device) =>
      limit(async () => {
        let result;
        try {
          result = await syncDevice(device, options);
        } catch (error) {
          // syncDevice never rejects, but a failing device must not stop the cycle anyway
          result = { hostname: device && device.hostname, ok: false, error: error.message };
        }
        run.results.push(result);
        return result;
      })
    )
  );
  run.results = results;
  run.ok = results.filter((result) => result.ok).length;
  run.failed = results.length - run.ok;
  run.finishedAt = new Date();
  run.durationMs = run.finishedAt - startedAt;
  logger.info(
    'sync run finished: ' + run.ok + ' ok, ' + run.failed + ' failed (' + run.durationMs + ' ms)'
  );
  return run;
}

async function syncAll(options = {}) {
  const devices = await Device.find(Device.activeFilter());
  return syncDevices(devices, options);
}

/** starts a background run (no-op when one is already running); resolves with the run promise */
function start(devices, options = {}) {
  if (currentRun) return currentRun.promise;
  const promise = syncDevices(devices, options)
    .catch((error) => {
      logger.error('sync run failed: ' + error.message);
      return {
        startedAt: new Date(),
        finishedAt: new Date(),
        total: devices.length,
        ok: 0,
        failed: devices.length,
        results: [],
        error: error.message,
      };
    })
    .then((run) => {
      lastRun = run;
      currentRun = null;
      return run;
    });
  currentRun = { startedAt: new Date(), total: devices.length, promise };
  return promise;
}

async function startAll(options = {}) {
  if (currentRun) return currentRun.promise;
  const devices = await Device.find(Device.activeFilter());
  return start(devices, options);
}

function isRunning() {
  return currentRun !== null;
}

function status() {
  return {
    running: currentRun ? { startedAt: currentRun.startedAt, total: currentRun.total } : null,
    lastRun,
  };
}

module.exports = { syncDevices, syncAll, start, startAll, isRunning, status };
