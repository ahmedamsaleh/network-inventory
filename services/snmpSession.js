/**
 * Small promise-based wrapper around the net-snmp library.
 *
 * This is the only module that imports net-snmp; the rest of the code talks
 * SNMP exclusively through `createSession()` and the `SnmpSession` methods
 * below, so the library can be swapped or upgraded in one place.
 *
 * Defaults (timeout, retries, version, source address) come from config.snmp
 * (SNMP_TIMEOUT_MS, SNMP_RETRIES, SNMP_VERSION, SNMP_SOURCE_ADDRESS).
 * createSession() never throws: when the target or community is missing it
 * returns a "null session" whose operations reject with a clear
 * SnmpSessionError and whose `error` property explains why.
 */
const snmp = require('net-snmp');
const util = require('util');
const config = require('../config');

class SnmpSessionError extends Error {
  constructor(message, host) {
    super(message);
    this.name = 'SnmpSessionError';
    this.host = host;
  }
}

const VERSIONS = { 1: snmp.Version1, '2c': snmp.Version2c, 2: snmp.Version2c };

function resolveVersion(version) {
  const key = String(version === undefined ? config.snmp.version : version).toLowerCase();
  return Object.prototype.hasOwnProperty.call(VERSIONS, key) ? VERSIONS[key] : snmp.Version2c;
}

class SnmpSession {
  /**
   * @param {object} options
   * @param {string} options.host             device IP address / hostname
   * @param {string} options.community        SNMP community string
   * @param {number} [options.timeoutMs]      request timeout (default config.snmp.timeoutMs)
   * @param {number} [options.retries]        retries per request (default config.snmp.retries)
   * @param {string|number} [options.version] '1' | '2c' (default config.snmp.version)
   * @param {string} [options.sourceAddress]  local address to send from (default SNMP_SOURCE_ADDRESS)
   * @param {number} [options.port]           UDP port (default 161)
   * @param {function} [options.onError]      called with socket-level errors
   */
  constructor(options) {
    const { host, community, timeoutMs, retries, version, sourceAddress, port, onError } =
      options || {};
    this.host = host;
    this.error = null;
    this.session = null;
    if (!host || typeof host !== 'string') {
      this.error = new SnmpSessionError(
        'no SNMP session: the device has no IP address / hostname',
        host
      );
      return;
    }
    if (!community || typeof community !== 'string') {
      this.error = new SnmpSessionError('no SNMP session: no community string for ' + host, host);
      return;
    }
    const sessionOptions = {
      version: resolveVersion(version),
      timeout: timeoutMs !== undefined ? timeoutMs : config.snmp.timeoutMs,
      retries: retries !== undefined ? retries : config.snmp.retries,
    };
    const source = sourceAddress !== undefined ? sourceAddress : config.snmp.sourceAddress;
    if (source) sessionOptions.sourceAddress = source;
    if (port !== undefined) sessionOptions.port = port;
    try {
      this.session = snmp.createSession(host, community, sessionOptions);
    } catch (error) {
      this.error = new SnmpSessionError('no SNMP session for ' + host + ': ' + error.message, host);
      return;
    }
    // an unhandled 'error' event would crash the process
    this.session.on('error', (error) => {
      if (onError) onError(error);
    });
    this.getAsync = util.promisify(this.session.get).bind(this.session);
    this.tableColumnsAsync = util.promisify(this.session.tableColumns).bind(this.session);
  }

  /** true when the session could not be created (see `error`) */
  get isNull() {
    return this.session === null;
  }

  rejectIfNull() {
    return this.isNull ? Promise.reject(this.error) : null;
  }

  /**
   * GET of scalar OIDs.
   * @param {string[]} oids
   * @returns {Promise<object>} values keyed by OID (Buffers converted to strings)
   */
  async get(oids) {
    if (this.isNull) throw this.error;
    const varbinds = await this.getAsync(oids);
    const result = {};
    for (const varbind of varbinds) {
      result[varbind.oid] = snmp.isVarbindError(varbind) ? null : toPlainValue(varbind.value);
    }
    return result;
  }

  /**
   * Walks the given columns of an SNMP table.
   * @param {string} oid              table OID, e.g. "1.3.6.1.2.1.2.2" (ifTable)
   * @param {number[]} columns        column numbers to fetch
   * @param {number} [maxRepetitions] max-repetitions for GETBULK (v2c only)
   * @returns {Promise<object>}       rows keyed by row index, each row keyed by column
   */
  async tableColumns(oid, columns, maxRepetitions) {
    if (this.isNull) throw this.error;
    return this.tableColumnsAsync(oid, columns, maxRepetitions || config.snmp.maxRepetitions);
  }

  /** Releases the underlying UDP socket (safe on a null session). */
  close() {
    if (this.session) {
      this.session.close();
      this.session = null;
    }
  }
}

/** Buffers (OctetString) -> utf8 strings, OIDs stay strings, numbers stay numbers */
function toPlainValue(value) {
  if (Buffer.isBuffer(value)) return value.toString();
  return value;
}

/** @returns {SnmpSession} never throws; check `session.isNull` / `session.error` */
function createSession(options) {
  return new SnmpSession(options);
}

/** true for the library's request-timeout error */
function isTimeoutError(error) {
  return Boolean(error) && error.name === 'RequestTimedOutError';
}

module.exports = { createSession, SnmpSession, SnmpSessionError, isTimeoutError, toPlainValue };
