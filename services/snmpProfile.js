/**
 * Which SNMP timeout / retry profile a device gets.
 *
 * A device is "known to be slow" when an operator flagged it (device.snmpSlow,
 * device edit form) or when its last SNMP_SLOW_AFTER_TIMEOUTS synchronisations
 * all timed out (device.snmpTimeouts, maintained by services/syncDevice). Such
 * devices are polled with the shorter SNMP_SLOW_TIMEOUT_MS / SNMP_SLOW_RETRIES
 * profile so that one unresponsive box no longer holds a whole sync run for
 * SNMP_TIMEOUT_MS x (SNMP_RETRIES + 1). The counter resets on the first
 * successful sync, which puts the device back on the default profile.
 *
 * Vendor-specific session options (services/vendors, e.g. the very long
 * timeouts of the special Juniper devices) still win over the automatic slow
 * profile; an explicit snmpSlow flag wins over everything.
 */
const config = require('../config');

/** 'flag' | 'timeouts' | null */
function slowReason(device) {
  if (!device) return null;
  if (device.snmpSlow) return 'flag';
  const after = config.snmp.slowAfterTimeouts;
  if (after > 0 && Number(device.snmpTimeouts || 0) >= after) return 'timeouts';
  return null;
}

function isKnownSlow(device) {
  return slowReason(device) !== null;
}

/** { timeoutMs, retries } of the slow profile */
function slowOptions() {
  return { timeoutMs: config.snmp.slowTimeoutMs, retries: config.snmp.slowRetries };
}

/**
 * Session options for a device, merging the vendor options.
 * @returns {{ options: object, profile: 'default'|'vendor'|'slow', reason: string|null }}
 */
function sessionOptions(device, vendorOptions) {
  const vendor = vendorOptions || {};
  const reason = slowReason(device);
  const hasVendorOptions = Object.keys(vendor).length > 0;
  if (reason === 'flag' || (reason === 'timeouts' && !hasVendorOptions)) {
    return { options: { ...vendor, ...slowOptions() }, profile: 'slow', reason };
  }
  return { options: { ...vendor }, profile: hasVendorOptions ? 'vendor' : 'default', reason };
}

module.exports = { slowReason, isKnownSlow, slowOptions, sessionOptions };
