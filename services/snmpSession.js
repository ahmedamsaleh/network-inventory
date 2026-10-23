/**
 * Small promise-based wrapper around the net-snmp library.
 *
 * This is the only module that imports net-snmp; the rest of the code talks
 * SNMP exclusively through `createSession()` and the `SnmpSession` methods
 * below, so the library can be swapped or upgraded in one place.
 */
const snmp = require('net-snmp');
const util = require('util');

class SnmpSession {
  /**
   * @param {object} options
   * @param {string} options.host        device IP address / hostname
   * @param {string} options.community   SNMP community string
   * @param {number} [options.timeoutMs] request timeout in milliseconds
   * @param {number} [options.retries]   number of retries per request
   * @param {number} [options.port]      UDP port (default 161)
   * @param {function} [options.onError] called with socket-level errors
   */
  constructor({ host, community, timeoutMs, retries, port, onError }) {
    const sessionOptions = {};
    if (timeoutMs !== undefined) sessionOptions.timeout = timeoutMs;
    if (retries !== undefined) sessionOptions.retries = retries;
    if (port !== undefined) sessionOptions.port = port;

    this.host = host;
    this.session = snmp.createSession(host, community, sessionOptions);
    // an unhandled 'error' event would crash the process
    this.session.on('error', (error) => {
      if (onError) onError(error);
    });
    this.tableColumnsAsync = util.promisify(this.session.tableColumns).bind(this.session);
  }

  /**
   * Walks the given columns of an SNMP table.
   * @param {string} oid              table OID, e.g. "1.3.6.1.2.1.2.2" (ifTable)
   * @param {number[]} columns        column numbers to fetch
   * @param {number} maxRepetitions   max-repetitions for GETBULK (v2c only)
   * @returns {Promise<object>}       rows keyed by row index, each row keyed by column
   */
  tableColumns(oid, columns, maxRepetitions) {
    return this.tableColumnsAsync(oid, columns, maxRepetitions);
  }

  /** Releases the underlying UDP socket. */
  close() {
    this.session.close();
  }
}

/** @returns {SnmpSession} */
function createSession(options) {
  return new SnmpSession(options);
}

/** true for the library's request-timeout error */
function isTimeoutError(error) {
  return Boolean(error) && error.name === 'RequestTimedOutError';
}

module.exports = { createSession, SnmpSession, isTimeoutError };
