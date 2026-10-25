/**
 * Formatting helpers available to every EJS template as `h`
 * (application.js sets response.locals.h).
 */
const UNKNOWN_VALUES = new Set(['Unknown', 'Unkown', '']);

function isBlank(value) {
  return value === undefined || value === null || UNKNOWN_VALUES.has(String(value).trim());
}

/** value or an em-dash placeholder ("Unknown"/"Unkown" are shown muted) */
function text(value, placeholder) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return placeholder === undefined ? '—' : placeholder;
  }
  return String(value);
}

function date(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

function dateTime(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

/** ISO string for <input type="datetime-local"> (no seconds/zone) */
function dateInput(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 16);
}

function number(value) {
  if (value === undefined || value === null || value === '') return '';
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString('en-US') : String(value);
}

/** bit/s -> human readable */
function bitrate(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n >= 1e9) return (n / 1e9).toFixed(n % 1e9 ? 1 : 0) + ' Gbit/s';
  if (n >= 1e6) return (n / 1e6).toFixed(n % 1e6 ? 1 : 0) + ' Mbit/s';
  if (n >= 1e3) return (n / 1e3).toFixed(n % 1e3 ? 1 : 0) + ' kbit/s';
  return n + ' bit/s';
}

function yesNo(value) {
  return value ? 'yes' : 'no';
}

/** bootstrap label class for a status word */
function statusClass(value) {
  const v = String(value || '').toLowerCase();
  if (['up', 'ok', 'done', 'yes', 'true', 'admin'].includes(v)) return 'label-success';
  if (['down', 'failed', 'error'].includes(v)) return 'label-danger';
  if (['running', 'testing', 'warning'].includes(v)) return 'label-warning';
  return 'label-default';
}

module.exports = { isBlank, text, date, dateTime, dateInput, number, bitrate, yesNo, statusClass };
