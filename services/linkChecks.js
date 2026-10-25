/**
 * Consistency check of interface.secondPOP against the Link collection:
 * for every interface that claims a second host, the link partner must exist
 * in the Link collection and secondPOP must be the partner's POP.
 */
const Interface = require('../models/interface');
const Link = require('../models/link');
const Device = require('../models/device');
const popData = require('./popData');
const parser = require('../middleware/parser/parser');
const { escapeRegExp } = require('./filters');

const COLUMNS = [
  ['hostname', 'hostname'],
  ['ifName', 'ifName'],
  ['secondHost', 'secondHost'],
  ['secondInterface', 'secondInterface'],
  ['secondPOP', 'secondPOP'],
  ['linkPartner', 'linkPartner'],
  ['linkPartnerInterface', 'linkPartnerInterface'],
  ['expectedPOP', 'expectedPOP'],
  ['status', 'status'],
  ['detail', 'detail'],
];

async function partnerPops(hostname) {
  const device = (await Device.findOne({
    hostname: new RegExp('^' + escapeRegExp(hostname) + '$', 'i'),
  }).lean()) || {
    hostname,
  };
  const pop = await popData.findDevicePop(device);
  const parsed = parser.parseHostname(hostname);
  const accepted = new Set();
  if (pop) {
    if (pop.pop_cty && pop.pop_cty !== 'Unknown') accepted.add(pop.pop_cty);
    if (pop.shortName) accepted.add(pop.shortName);
  }
  if (parsed && parsed.popName) accepted.add(parsed.popName);
  if (device.pop && device.pop !== 'Unknown' && device.pop !== 'Unkown') accepted.add(device.pop);
  const expected =
    pop && pop.pop_cty && pop.pop_cty !== 'Unknown' ? pop.pop_cty : parsed ? parsed.popName : '';
  return { expected, accepted };
}

/** one check result for an interface document */
async function checkInterface(intf) {
  const result = {
    hostname: intf.hostname || (intf.device && intf.device.hostname) || '',
    ifName: intf.ifName || intf.name || '',
    secondHost: intf.secondHost || '',
    secondInterface: intf.secondInterface || '',
    secondPOP: intf.secondPOP || '',
    linkPartner: '',
    linkPartnerInterface: '',
    expectedPOP: '',
    status: 'ok',
    detail: '',
  };
  const link = await Link.findOne({
    $or: [
      { device1: result.hostname, interface1: result.ifName },
      { device2: result.hostname, interface2: result.ifName },
    ],
  }).lean();
  if (!link) {
    result.status = 'no-link';
    result.detail = 'no Link record for this interface';
    return result;
  }
  const info = parser.linkInfoFromLink(link, result.hostname);
  result.linkPartner = info.secondHost;
  result.linkPartnerInterface = info.secondInterface;
  if (result.secondHost && result.secondHost.toUpperCase() !== info.secondHost.toUpperCase()) {
    result.status = 'partner-mismatch';
    result.detail = 'secondHost differs from the Link partner';
    return result;
  }
  const { expected, accepted } = await partnerPops(info.secondHost);
  result.expectedPOP = expected;
  if (!result.secondPOP) {
    result.status = 'missing';
    result.detail = 'secondPOP is empty';
  } else if (
    ![...accepted].some((value) => value.toUpperCase() === result.secondPOP.toUpperCase())
  ) {
    result.status = 'mismatch';
    result.detail = 'secondPOP is not the POP of ' + info.secondHost;
  }
  return result;
}

/**
 * Streams check results for the interfaces matching `filter` that have link
 * data (a secondHost) - or all matching interfaces when `includeUnlinked`.
 */
async function* rows(filter = {}, options = {}) {
  const query = options.includeUnlinked
    ? filter
    : { $and: [filter, { secondHost: { $exists: true, $nin: ['', null] } }] };
  const cursor = Interface.find(query).sort({ hostname: 1, ifIndex: 1 }).lean().cursor();
  for await (const intf of cursor) {
    yield await checkInterface(intf);
  }
}

/** full report (array + counters) */
async function report(filter = {}, options = {}) {
  const out = { total: 0, ok: 0, problems: 0, byStatus: {}, rows: [] };
  for await (const row of rows(filter, options)) {
    out.total += 1;
    out.byStatus[row.status] = (out.byStatus[row.status] || 0) + 1;
    if (row.status === 'ok') out.ok += 1;
    else out.problems += 1;
    if (out.rows.length < (options.maxRows || 5000)) out.rows.push(row);
  }
  return out;
}

module.exports = { COLUMNS, rows, report, checkInterface };
