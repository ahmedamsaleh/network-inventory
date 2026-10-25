/**
 * Pure parsing helpers for interface aliases, speeds and hostnames.
 *
 * Everything in here is side-effect free and never throws: bad input yields
 * the empty-string defaults (see emptyFields()) and, for speeds, 0/'Unknown'.
 *
 * Alias rules (first match wins, tested case-insensitively on the trimmed
 * alias, INT- first):
 *   1. INT-…            International   split on -          11 tokens (prefix + 10)
 *   2. Cache-…          Cache           split on -           8 tokens
 *   3. -ALPHA|HS|LTE|ESP-BITSTREAM
 *                       Bitstream       split on -           5 tokens
 *   4. -BITSTREAM       Bitstream       split on -           4 tokens
 *   5. ESP-…            ESP             split on -           6 tokens
 *   6. -FW and -IR      Firewall        _/space -> -, then - 7 tokens
 *   7. NR_…             NR              _/space -> -, then - 10 tokens
 *   8. _ENB_            LTE             _/space -> -, then - 8 tokens
 *   9. EPC              EPC             split on space       4 tokens
 *  10. pre1             DPI             split on -           3 tokens
 * "split on -" also splits on whitespace (the BITSTREAM samples carry the
 * link number and speed after a space); empty tokens (trailing "-") are
 * dropped. Token counts include the first token. When the count does not
 * match, unknownFlag = 1 and the fields stay at their defaults ("Unknown" /
 * 0 for the speed).
 */

const SPECIAL_SERVICES = {
  INT: 'International',
  CACHE: 'Cache',
  BITSTREAM: 'Bitstream',
  ESP: 'ESP',
  FIREWALL: 'Firewall',
  NR: 'NR',
  LTE: 'LTE',
  EPC: 'EPC',
  DPI: 'DPI',
};

const GIGA = 1e9;
const MEGA = 1e6;
const KILO = 1e3;

/** speed categories, evaluated top-down on the best known speed in bit/s */
const SPEED_CATEGORIES = [
  { min: 100 * GIGA, name: '100G+' },
  { min: 40 * GIGA, name: '40G' },
  { min: 10 * GIGA, name: '10G' },
  { min: GIGA, name: '1G' },
  { min: 100 * MEGA, name: '100M' },
  { min: 1, name: '<100M' },
];

function emptyFields() {
  return {
    service: '',
    provider: '',
    termination: '',
    bundleId: '',
    linkNumber: '',
    CID: '',
    BTCID: '',
    subCable: '',
    customer: '',
    sourceCore: '',
    destinationCore: '',
    vendor: '',
    speed: 0,
    speedToken: '',
    pop: '',
    node: '',
    serverNumber: '',
    fwType: '',
    serviceType: '',
    ipType: '',
    siteCode: '',
    connType: '',
    emsOrder: '',
    connectedBW: '',
    dpiName: '',
    portID: '',
    preNumber: '',
  };
}

function emptyLink() {
  return {
    type: '', // Local | WAN (from the Link data, see linkInfoFromLink)
    secondPOP: '',
    secondHost: '',
    secondInterface: '',
    label: '',
    specialService: '',
  };
}

function toText(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Buffer.isBuffer(value)) return value.toString();
  return '';
}

/** "-" and whitespace separated tokens, empty tokens dropped */
function splitOnDash(text) {
  return text.split(/[-\s]+/).filter((token) => token !== '');
}

/** "_" and whitespace become "-", then splitOnDash */
function splitNormalized(text) {
  return splitOnDash(text.replace(/[_\s]+/g, '-'));
}

function splitOnSpace(text) {
  return text.split(/\s+/).filter((token) => token !== '');
}

function lastChar(token) {
  return token ? token.slice(-1) : '';
}

/**
 * Converts a speed token to bit/s:
 *   1G, 10GIG, GIG -> x1e9 (GIG alone = 1 Gb/s); 100M or a bare number -> x1e6;
 *   512K -> x1e3; empty / unknown / 0 / anything else -> 0.
 */
function parseSpeedToken(token) {
  const text = toText(token).trim().toUpperCase();
  if (text === '' || text === 'UNKNOWN') return 0;
  const match = /^(\d+(?:\.\d+)?)?\s*(GIG|GBPS|GB|G|MBPS|MB|M|KBPS|KB|K)?$/.exec(text);
  if (!match) return 0;
  const [, digits, unit] = match;
  if (digits === undefined && unit === undefined) return 0;
  const number = digits === undefined ? 1 : parseFloat(digits);
  if (!Number.isFinite(number) || number <= 0) return 0;
  if (!unit) return number * MEGA; // bare number
  if (unit.startsWith('G')) return number * GIGA;
  if (unit.startsWith('M')) return number * MEGA;
  return number * KILO;
}

/** "Unknown" for 0/invalid, otherwise e.g. "10 Gbps", "155 Mbps", "512 Kbps" */
function formatSpeed(bitsPerSecond) {
  const bps = Number(bitsPerSecond);
  if (!Number.isFinite(bps) || bps <= 0) return 'Unknown';
  const units = [
    [GIGA, 'Gbps'],
    [MEGA, 'Mbps'],
    [KILO, 'Kbps'],
  ];
  for (const [factor, unit] of units) {
    if (bps >= factor) {
      const value = bps / factor;
      return (Number.isInteger(value) ? value : Number(value.toFixed(2))) + ' ' + unit;
    }
  }
  return bps + ' bps';
}

function speedCategory(bitsPerSecond) {
  const bps = Number(bitsPerSecond);
  if (!Number.isFinite(bps) || bps <= 0) return 'Unknown';
  for (const category of SPEED_CATEGORIES) {
    if (bps >= category.min) return category.name;
  }
  return 'Unknown';
}

/**
 * Speed texts for an interface.
 * @param {object} speeds
 * @param {number|string} [speeds.ifSpeed]      SNMP ifSpeed (bit/s) or a token
 * @param {number|string} [speeds.ifHighSpeed]  SNMP ifHighSpeed (Mbit/s) or a token
 * @param {number|string} [speeds.sp_speed]     speed parsed from the alias (bit/s or token)
 * @param {number|string} [speeds.actualspeed]  measured/configured speed (bit/s or token)
 * @returns {{ifSpeedText, ifHighSpeedText, sp_speedText, actualspeedText, speedCat}}
 */
function parseSpeed(speeds) {
  const input = speeds && typeof speeds === 'object' ? speeds : {};
  const bps = (value, unitFactor) => {
    if (typeof value === 'number')
      return Number.isFinite(value) && value > 0 ? value * unitFactor : 0;
    const text = toText(value).trim();
    if (/^\d+(\.\d+)?$/.test(text)) return parseFloat(text) * unitFactor;
    return parseSpeedToken(text);
  };
  const ifSpeed = bps(input.ifSpeed, 1);
  const ifHighSpeed = bps(input.ifHighSpeed, MEGA);
  const spSpeed = bps(input.sp_speed, 1);
  const actualspeed = bps(input.actualspeed, 1);
  const best = [actualspeed, spSpeed, ifHighSpeed, ifSpeed].find((value) => value > 0) || 0;
  return {
    ifSpeedText: formatSpeed(ifSpeed),
    ifHighSpeedText: formatSpeed(ifHighSpeed),
    sp_speedText: formatSpeed(spSpeed),
    actualspeedText: formatSpeed(actualspeed),
    speedCat: speedCategory(best),
  };
}

/* ------------------------------------------------------------------ */
/* alias patterns                                                      */
/* ------------------------------------------------------------------ */

const PATTERNS = [
  {
    specialService: SPECIAL_SERVICES.INT,
    test: (upper) => upper.startsWith('INT-'),
    split: splitOnDash,
    count: 11,
    // INT-service-provider-termination-speed-bundle-connType-link-CID-BTCID-subCable
    map: (t) => ({
      service: t[1],
      provider: t[2],
      termination: t[3],
      speedToken: t[4],
      bundleId: t[5],
      connType: t[6],
      linkNumber: t[7],
      CID: t[8],
      BTCID: t[9],
      subCable: t[10],
    }),
  },
  {
    specialService: SPECIAL_SERVICES.CACHE,
    test: (upper) => upper.startsWith('CACHE-'),
    split: splitOnDash,
    count: 8,
    // Cache-provider-node-speed-bundle-link-CID-serverNumber
    map: (t) => ({
      provider: t[1],
      node: t[2],
      pop: t[2],
      speedToken: t[3],
      bundleId: t[4],
      linkNumber: t[5],
      CID: t[6],
      serverNumber: t[7],
    }),
  },
  {
    specialService: SPECIAL_SERVICES.BITSTREAM,
    test: (upper) => /-(ALPHA|HS|LTE|ESP)-BITSTREAM/.test(upper),
    split: splitOnDash,
    count: 5,
    // customer-serviceType-BITSTREAM link speed
    map: (t) => ({ customer: t[0], serviceType: t[1], linkNumber: t[3], speedToken: t[4] }),
  },
  {
    specialService: SPECIAL_SERVICES.BITSTREAM,
    test: (upper) => upper.includes('-BITSTREAM'),
    split: splitOnDash,
    count: 4,
    // customer-BITSTREAM link speed
    map: (t) => ({ customer: t[0], linkNumber: t[2], speedToken: t[3] }),
  },
  {
    specialService: SPECIAL_SERVICES.ESP,
    test: (upper) => upper.startsWith('ESP-'),
    split: splitOnDash,
    count: 6,
    // ESP-customer-POP-connType-emsOrder-connectedBW
    map: (t) => ({
      customer: t[1],
      pop: t[2],
      connType: t[3],
      emsOrder: t[4],
      connectedBW: t[5],
      speedToken: t[5],
    }),
  },
  {
    specialService: SPECIAL_SERVICES.FIREWALL,
    // rule: "-FW and -IR"
    // (Ireland country suffix)
    test: (upper) => upper.includes('-FW') && upper.includes('-IR'),
    split: splitNormalized,
    count: 7,
    // POP-GI-serviceType-ipType-FWnnV-…-… (vendor = last char of field 5)
    map: (t) => ({
      pop: t[0],
      serviceType: t[2],
      ipType: t[3],
      fwType: t[4].slice(0, -1),
      vendor: lastChar(t[4]),
    }),
  },
  {
    specialService: SPECIAL_SERVICES.NR,
    test: (upper) => upper.startsWith('NR_'),
    split: splitNormalized,
    count: 10,
    // NR-provider-service-sourceCore-destinationCore-NnnV-…-…-link-speed (vendor = last char of field 6)
    map: (t) => ({
      provider: t[1],
      service: t[2],
      sourceCore: t[3],
      destinationCore: t[4],
      vendor: lastChar(t[5]),
      linkNumber: t[8],
      speedToken: t[9],
    }),
  },
  {
    specialService: SPECIAL_SERVICES.LTE,
    test: (upper) => upper.includes('_ENB_'),
    split: splitNormalized,
    count: 8,
    // POP-ENB-siteCode-EnnV-…-…-link-speed (vendor = last char of field 4)
    map: (t) => ({
      pop: t[0],
      siteCode: t[2],
      vendor: lastChar(t[3]),
      linkNumber: t[6],
      speedToken: t[7],
    }),
  },
  {
    specialService: SPECIAL_SERVICES.EPC,
    test: (upper) => upper.includes('EPC'),
    split: splitOnSpace,
    count: 4,
    // provider EPC link speed
    map: (t) => ({ provider: t[0], serviceType: t[1], linkNumber: t[2], speedToken: t[3] }),
  },
  {
    specialService: SPECIAL_SERVICES.DPI,
    test: (upper) => upper.includes('PRE1'),
    split: splitOnDash,
    count: 3,
    // POP-PREn-portID
    map: (t) => ({
      pop: t[0],
      dpiName: t[0],
      preNumber: t[1].replace(/^PRE/i, ''),
      portID: t[2],
    }),
  },
];

function buildLabel(specialService, fields) {
  return [
    specialService,
    fields.provider || fields.customer || fields.pop,
    fields.linkNumber,
    formatSpeed(fields.speed),
  ]
    .filter((part) => part && part !== 'Unknown')
    .join(' ');
}

/**
 * Parses an interface alias (ifAlias) into structured fields.
 * Never throws; unknown/unmatched input yields the defaults and pattern ''.
 *
 * @returns {{ pattern: string, unknownFlag: 0|1, fieldCount: number,
 *             fields: object, sp_speedText: string, link: object }}
 */
function parseIfAlias(ifAlias) {
  const alias = toText(ifAlias).trim();
  const result = {
    alias,
    pattern: '',
    unknownFlag: 0,
    fieldCount: 0,
    ...emptyFields(),
    sp_speedText: 'Unknown',
    link: emptyLink(),
  };
  if (alias === '') return result;

  const upper = alias.toUpperCase();
  const pattern = PATTERNS.find((candidate) => candidate.test(upper));
  if (!pattern) return result;

  result.pattern = pattern.specialService;
  result.link.specialService = pattern.specialService;
  const tokens = pattern.split(alias);
  result.fieldCount = tokens.length;
  if (tokens.length !== pattern.count) {
    result.unknownFlag = 1;
    return result;
  }
  Object.assign(result, pattern.map(tokens));
  result.speed = parseSpeedToken(result.speedToken);
  result.sp_speedText = formatSpeed(result.speed);
  result.link.label = buildLabel(pattern.specialService, result);
  return result;
}

/**
 * Link information from a Link record ({ device1, interface1, device2,
 * interface2 }) for an interface on `localHostname`: the other end, its POP
 * (from the hostname naming rule) and whether it is Local (same POP) or WAN.
 */
function linkInfoFromLink(linkRecord, localHostname) {
  const info = emptyLink();
  if (!linkRecord || typeof linkRecord !== 'object') return info;
  const local = toText(localHostname).trim().toUpperCase();
  const device1 = toText(linkRecord.device1).trim();
  const device2 = toText(linkRecord.device2).trim();
  const isDevice1 = device1.toUpperCase() === local;
  const otherHost = isDevice1 ? device2 : device1;
  const otherInterface = toText(isDevice1 ? linkRecord.interface2 : linkRecord.interface1).trim();
  if (otherHost === '') return info;
  info.secondHost = otherHost;
  info.secondInterface = otherInterface;
  const localDetails = parseHostname(localHostname);
  const otherDetails = parseHostname(otherHost);
  info.secondPOP = otherDetails ? otherDetails.popName : '';
  if (localDetails && otherDetails) {
    info.type =
      localDetails.popName.toUpperCase() === otherDetails.popName.toUpperCase() ? 'Local' : 'WAN';
  }
  info.label = ['Link to', otherHost, otherInterface].filter(Boolean).join(' ');
  return info;
}

/**
 * Hostname naming rule: <POP>-<TYPE><NN><VENDOR>-<COUNTY>-<n>, e.g.
 * DUBP-RCJ1-DUB-01 -> { popName: 'DUBP', popCty: 'DUB', deviceType, deviceVendor }.
 * Returns null when the hostname does not follow the rule.
 */
function parseHostname(hostname, lookups) {
  const text = toText(hostname).trim();
  if (text === '') return null;
  const nameFields = text.split('-');
  if (nameFields.length !== 4) return null;
  const code = nameFields[1];
  if (!/^[A-Za-z0-9]{4}$/.test(code)) return null;
  const tables = lookups || require('../../lookUps/enrich');
  return {
    popName: nameFields[0],
    popCty: nameFields[2],
    deviceType: (tables.deviceType || {})[code.charAt(0).toUpperCase()],
    deviceVendor: (tables.deviceVendor || {})[code.charAt(3).toUpperCase()],
  };
}

module.exports = {
  SPECIAL_SERVICES,
  SPEED_CATEGORIES,
  emptyFields,
  emptyLink,
  parseIfAlias,
  parseSpeedToken,
  parseSpeed,
  formatSpeed,
  speedCategory,
  linkInfoFromLink,
  parseHostname,
};
