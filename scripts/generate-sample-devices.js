/**
 * Generates samples/devices-sample.xlsx: a "Devices" sheet with 12 000
 * routers / switches / MSANs / GPON OLTs / DSLAMs following the hostname
 * naming rule (<POP>-<TYPE><NN><VENDOR>-<CTY>-<n>) and a "POPs" sheet in the
 * layout of the POP import (shortName, cty, district, sector, popType,
 * popLongName). Deterministic (seeded), so re-running yields the same file.
 *
 *   node scripts/generate-sample-devices.js [rows] [output]
 */
const path = require('path');
const ExcelJS = require('exceljs');

const ROWS = Number(process.argv[2] || 12000);
const OUTPUT = process.argv[3] || path.join(__dirname, '..', 'samples', 'devices-sample.xlsx');

// small deterministic PRNG (mulberry32)
function prng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = prng(20240101);
const pick = (list) => list[Math.floor(random() * list.length)];

const CTYS = [
  ['DUB', 'Dublin'],
  ['GAL', 'Galway'],
  ['COR', 'Cork'],
  ['LIM', 'Limerick'],
  ['WAT', 'Waterford'],
  ['KER', 'Kerry'],
  ['MAY', 'Mayo'],
  ['SLI', 'Sligo'],
  ['DON', 'Donegal'],
  ['KLK', 'Kilkenny'],
  ['WEX', 'Wexford'],
  ['MEA', 'Meath'],
];
const SECTORS = ['North', 'South', 'East', 'West', 'Central'];
const POP_TYPES = ['Core', 'Edge', 'Access', 'Aggregation'];
const TYPES = [
  // code, type, vendors -> models, share
  {
    code: 'R',
    type: 'Router',
    models: {
      J: ['MX480', 'MX960', 'MX204'],
      H: ['NE40E-X8', 'NE8000-M8'],
      C: ['ASR9006', 'ASR1006'],
    },
    share: 0.15,
  },
  {
    code: 'S',
    type: 'Switch',
    models: { J: ['EX4300', 'QFX5100'], H: ['S5720', 'S6730'], C: ['C9300', 'C3850'] },
    share: 0.25,
  },
  {
    code: 'M',
    type: 'MSAN',
    models: { Z: ['C300', 'C320'], A: ['ISAM 7302', 'ISAM 7330'], H: ['MA5616'] },
    share: 0.3,
  },
  {
    code: 'G',
    type: 'GPON',
    models: { H: ['MA5800-X17', 'MA5800-X7'], Z: ['C600', 'C650'] },
    share: 0.2,
  },
  {
    code: 'D',
    type: 'DSLAM',
    models: { A: ['ISAM 7301', 'hiX 5630'], Z: ['ZXDSL 9806H'] },
    share: 0.1,
  },
];
const VENDOR_NAMES = { J: 'Juniper', H: 'Huawei', C: 'Cisco', Z: 'ZTE', A: 'Alcatel' };

function typeFor(index) {
  const r = (index % 100) / 100;
  let acc = 0;
  for (const entry of TYPES) {
    acc += entry.share;
    if (r < acc) return entry;
  }
  return TYPES[TYPES.length - 1];
}

// 120 POPs, 10 per county
const pops = [];
for (const [cty, ctyName] of CTYS) {
  for (let i = 1; i <= 10; i++) {
    const shortName = cty + 'P' + String(i).padStart(2, '0');
    pops.push({
      shortName,
      cty,
      district: ctyName + ' district ' + i,
      sector: pick(SECTORS),
      popType: i <= 2 ? 'Core' : pick(POP_TYPES),
      popLongName: ctyName + ' POP ' + i,
    });
  }
}

async function main() {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    filename: OUTPUT,
    useStyles: false,
    useSharedStrings: true,
  });
  const devices = workbook.addWorksheet('Devices');
  devices
    .addRow([
      'hostname',
      'ipaddress',
      'community',
      'type',
      'vendor',
      'model',
      'pop',
      'cty',
      'district',
      'popType',
      'popLongName',
      'cabinet',
      'description',
    ])
    .commit();
  const counters = {};
  for (let i = 0; i < ROWS; i++) {
    const pop = pops[i % pops.length];
    const entry = typeFor(i);
    const vendorCodes = Object.keys(entry.models);
    const vendor = vendorCodes[Math.floor(random() * vendorCodes.length)];
    const model = pick(entry.models[vendor]);
    const key = pop.shortName + entry.code;
    counters[key] = (counters[key] || 0) + 1;
    const number = counters[key];
    const unit = String(1 + Math.floor(random() * 8)).padStart(2, '0');
    const hostname = `${pop.shortName}-${entry.code}${unit}${vendor}-${pop.cty}-${String(number).padStart(2, '0')}`;
    const n = i + 1; // 10.1.0.1, 10.1.0.2, ...
    const ip = `10.${Math.floor(n / 65536) + 1}.${Math.floor(n / 256) % 256}.${n % 256}`;
    devices
      .addRow([
        hostname,
        ip,
        entry.type === 'MSAN' || entry.type === 'DSLAM' ? 'access-ro' : 'public',
        entry.type,
        VENDOR_NAMES[vendor],
        model,
        pop.shortName,
        pop.cty,
        pop.district,
        pop.popType,
        pop.popLongName,
        pop.shortName + '-CAB' + String(1 + (number % 6)).padStart(2, '0'),
        `${entry.type} ${model} at ${pop.popLongName}`,
      ])
      .commit();
  }
  devices.commit();
  const popSheet = workbook.addWorksheet('POPs');
  popSheet.addRow(['shortName', 'cty', 'district', 'sector', 'popType', 'popLongName']).commit();
  for (const pop of pops)
    popSheet
      .addRow([pop.shortName, pop.cty, pop.district, pop.sector, pop.popType, pop.popLongName])
      .commit();
  popSheet.commit();
  await workbook.commit();
  console.log('wrote ' + OUTPUT + ': ' + ROWS + ' devices, ' + pops.length + ' POPs');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
