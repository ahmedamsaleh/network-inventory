const generic = require('./generic');

/**
 * Juniper (hostname vendor code "J", e.g. ONGAR-R39J-D-IR).
 *
 * Two devices are discovered differently and are identified by hostname
 * (SYNC_JUNIPER_SPECIAL_DEVICES overrides the list):
 *   - the SNMP session uses a 300000 ms timeout and 10 retries (instead of
 *     the default 60000 ms / 5),
 *   - ifTable rows are kept only when the interface is up, ifDescr is not
 *     empty and ifDescr contains no '.' (sub-interfaces such as
 *     ge-0/0/0/0.0 are skipped); other devices only need the status to be up.
 */
const DEFAULT_SPECIAL_DEVICES = ['ONGAR-R39J-D-IR', 'AUTO-R38J-WIK-IR'];
const SPECIAL_SESSION = { timeoutMs: 300000, retries: 10 };
const STATUS_UP = 1;

function specialDevices() {
  const fromEnv = process.env.SYNC_JUNIPER_SPECIAL_DEVICES;
  if (!fromEnv) return DEFAULT_SPECIAL_DEVICES;
  return fromEnv
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}

function isSpecialDevice(device) {
  const hostname = String((device && device.hostname) || '').toUpperCase();
  return specialDevices().some((name) => name.toUpperCase() === hostname);
}

function sessionOptions(device) {
  return isSpecialDevice(device) ? { ...SPECIAL_SESSION } : {};
}

function filterRows(rows, ctx) {
  if (!ctx || !isSpecialDevice(ctx.device)) return rows;
  return rows.filter((row) => {
    const descr = String(row.ifDescr || '').trim();
    return (
      Number(row.ifAdminStatus) === STATUS_UP &&
      Number(row.ifOperStatus) === STATUS_UP &&
      descr !== '' &&
      !descr.includes('.')
    );
  });
}

module.exports = {
  ...generic,
  name: 'juniper',
  enterpriseOids: ['1.3.6.1.4.1.2636'],
  keywords: ['juniper', 'junos'],
  DEFAULT_SPECIAL_DEVICES,
  SPECIAL_SESSION,
  specialDevices,
  isSpecialDevice,
  sessionOptions,
  filterRows,
};
