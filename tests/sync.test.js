/**
 * SNMP synchronisation (services/syncDevice + services/syncRunner) with a
 * mocked SNMP session: three fake devices, one of them failing.
 */
const { bootApp, adminAgent } = require('./helpers/boot');

// the services load config.js, which must see the per-test environment set by
// bootApp() - so they are required after the app has booted (see beforeAll)
let syncDevices;
let OIDS;
let isInterestingInterface;
let vendors;
let IF;
let IFX;

/** one ifTable/ifXTable row pair */
function row(
  index,
  {
    descr,
    type = 6,
    speed = 1e9,
    admin = 1,
    oper = 1,
    name,
    alias = '',
    highSpeed,
    inOctets = 10,
    outOctets = 20,
    ifIndexValue,
  }
) {
  return {
    key: String(index),
    ifTable: {
      [IF.ifIndex]: ifIndexValue !== undefined ? ifIndexValue : index,
      [IF.ifDescr]: descr !== undefined ? descr : name,
      [IF.ifType]: type,
      [IF.ifSpeed]: speed,
      [IF.ifAdminStatus]: admin,
      [IF.ifOperStatus]: oper,
    },
    ifXTable: {
      [IFX.ifName]: Buffer.from(name),
      [IFX.ifAlias]: Buffer.from(alias),
      [IFX.ifHighSpeed]: highSpeed !== undefined ? highSpeed : speed / 1e6,
      [IFX.ifHCInOctets]: inOctets,
      [IFX.ifHCOutOctets]: outOctets,
    },
  };
}

function tables(rows) {
  const ifTable = {};
  const ifXTable = {};
  for (const r of rows) {
    ifTable[r.key] = r.ifTable;
    ifXTable[r.key] = r.ifXTable;
  }
  return { [OIDS.ifTable.oid]: ifTable, [OIDS.ifXTable.oid]: ifXTable };
}

function timeoutError() {
  const error = new Error('Request timed out');
  error.name = 'RequestTimedOutError';
  return error;
}

/** fake session factory: fixtures keyed by host; tracks concurrency and closes */
function fakeSessionFactory(fixtures, stats) {
  return ({ host, community, timeoutMs, retries }) => {
    const fixture = fixtures[host];
    stats.created.push({ host, community, timeoutMs, retries });
    const session = {
      isNull: !fixture,
      error: fixture ? null : new Error('no fixture for ' + host),
      async get(oids) {
        stats.active += 1;
        stats.maxActive = Math.max(stats.maxActive, stats.active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        stats.active -= 1;
        if (fixture.fail) throw fixture.fail;
        return Object.fromEntries(oids.map((oid) => [oid, fixture.sys[oid]]));
      },
      async tableColumns(oid) {
        if (fixture.fail) throw fixture.fail;
        if (!fixture.tables[oid]) throw new Error('NoSuchObject: ' + oid);
        return fixture.tables[oid];
      },
      close() {
        stats.closed += 1;
      },
    };
    return session;
  };
}

const HUAWEI_ALIAS = 'INT-IPT-Cogent-DUB-10GIG-B2-NB-L22-1_300050661-EIG_IPT_10G_0019-EIG';

let app;
let agent;
let stats;
let fixtures;
let createSession;
let huawei;
let zteMsan;
let broken;

beforeAll(async () => {
  app = await bootApp();
  agent = await adminAgent(app);
  ({ syncDevices } = require('../services/syncRunner'));
  ({ OIDS, isInterestingInterface } = require('../services/syncDevice'));
  vendors = require('../services/vendors');
  IF = OIDS.ifTable.columns;
  IFX = OIDS.ifXTable.columns;
  const { Device, Link } = app.models;
  const author = { id: new app.mongoose.Types.ObjectId(), email: 'seed@example.com' };
  await app.models.POP.create({
    name: 'Dublin main POP',
    shortName: 'DUBP',
    cty: 'DUB',
    district: 'Downtown',
    sector: 'North',
    popType: 'Core',
    popLongName: 'Dublin main POP',
  });
  huawei = await Device.create({
    hostname: 'DUBP-RHH1-DUB-01',
    ipaddress: '10.10.0.1',
    community: 'c-huawei',
    pop: 'DUB',
    popName: { name: 'Dublin POP' },
    sector: { name: 'North' },
    cty: 'Dublin',
    type: 'Router',
    vendor: 'Huawei',
    model: 'NE40',
    author,
  });
  zteMsan = await Device.create({
    hostname: 'CORP-MZZ1-COR-01',
    ipaddress: '10.10.0.2',
    community: 'c-zte',
    pop: 'COR',
    type: 'MSAN',
    vendor: 'ZTE',
    author,
  });
  broken = await Device.create({
    hostname: 'GALP-RCJ1-GAL-01',
    ipaddress: '10.10.0.3',
    community: 'c-broken',
    type: 'Router',
    author,
  });
  await Link.create({
    device1: 'DUBP-RHH1-DUB-01',
    interface1: 'GigabitEthernet0/0/1',
    device2: 'CORP-MZZ1-COR-01',
    interface2: 'ge-0/1/1',
  });

  fixtures = {
    '10.10.0.1': {
      sys: {
        [OIDS.sysDescr]: Buffer.from('Huawei Versatile Routing Platform'),
        [OIDS.sysObjectID]: '1.3.6.1.4.1.2011.2.62.1',
        [OIDS.sysName]: Buffer.from('DUBP-RHH1-DUB-01'),
      },
      tables: tables([
        row(1, { name: 'GigabitEthernet0/0/1', alias: HUAWEI_ALIAS, speed: 1e9 }),
        // Huawei: ifIndex column decoded as a negative Integer32; the row key is the unsigned value
        row(2147483650, {
          name: 'GigabitEthernet0/0/2',
          alias: 'THREE-BITSTREAM L6 1GIG',
          ifIndexValue: -2147483646,
        }),
        row(3, { name: 'GigabitEthernet0/0/3', alias: 'plain', oper: 2 }), // oper down -> not interesting
        row(4, { name: 'GigabitEthernet0/0/4', descr: 'mpls tunnel' }), // mpls -> not interesting
        row(5, { name: 'LoopBack0', alias: '' }), // no rule matches
      ]),
    },
    '10.10.0.2': {
      sys: {
        [OIDS.sysDescr]: Buffer.from('ZTE ZXA10 C300'),
        [OIDS.sysObjectID]: '1.3.6.1.4.1.3902.1082',
        [OIDS.sysName]: Buffer.from('CORP-MZZ1-COR-01'),
      },
      tables: tables([
        row(1, { name: 'ge-0/1/1', alias: 'uplink', speed: 1e9, highSpeed: 0 }), // ZTE: ifHighSpeed missing
        row(2, {
          name: 'xe-0/2/1',
          alias: 'ESP-BT_ACCESS-TEMPLEBAR-INT-1-100',
          speed: 4294967295,
          highSpeed: 10000,
        }), // saturated ifSpeed
        row(3, { name: 'ge-0/1/3', alias: 'x', speed: 1e9, highSpeed: 1000000000 }), // ifHighSpeed in bit/s
        row(101, { name: 'ge-1/1/1', type: 97, speed: 100e6 }), // vdsl subscriber port (name would match) -> MSAN filter
        row(102, { name: 'ge-1/1/2', type: 94, speed: 20e6 }), // adsl subscriber port
      ]),
    },
    '10.10.0.3': { sys: {}, tables: {}, fail: timeoutError() },
  };
  stats = { created: [], closed: 0, active: 0, maxActive: 0 };
  createSession = fakeSessionFactory(fixtures, stats);
});

afterAll(async () => {
  await app.close();
});

describe('sync run on 3 fake devices (one failing)', () => {
  let run;

  test('completes, reports per-device results and never throws', async () => {
    run = await syncDevices([huawei, zteMsan, broken], {
      createSession,
      concurrency: 2,
      now: new Date('2024-05-01T10:00:00Z'),
    });
    expect(run).toMatchObject({ total: 3, ok: 2, failed: 1 });
    expect(run.results).toHaveLength(3);
    const byHost = Object.fromEntries(run.results.map((r) => [r.hostname, r]));
    expect(byHost['DUBP-RHH1-DUB-01']).toMatchObject({
      ok: true,
      vendor: 'huawei',
      sys: { sysName: 'DUBP-RHH1-DUB-01', sysObjectID: '1.3.6.1.4.1.2011.2.62.1' },
      interfaces: { total: 5, interesting: 2, created: 2, updated: 0 },
      raw: 5,
    });
    expect(byHost['CORP-MZZ1-COR-01']).toMatchObject({
      ok: true,
      vendor: 'zte',
      interfaces: { total: 5, interesting: 3, created: 3 },
      raw: 5,
    });
    expect(byHost['GALP-RCJ1-GAL-01']).toMatchObject({
      ok: false,
      error: 'Request timed out',
      errorName: 'RequestTimedOutError',
    });
    expect(run.finishedAt).toBeInstanceOf(Date);
    // bounded concurrency and every session closed, including the failing one
    expect(stats.maxActive).toBeLessThanOrEqual(2);
    expect(stats.closed).toBe(3);
    expect(stats.created.map((c) => c.community).sort()).toEqual(['c-broken', 'c-huawei', 'c-zte']);
  });

  test('interfaces are upserted by (hostname, ifIndex), parsed and enriched', async () => {
    const { Interface } = app.models;
    const docs = await Interface.find({ hostname: 'DUBP-RHH1-DUB-01' }).sort({ ifIndex: 1 });
    expect(docs.map((d) => d.ifIndex)).toEqual([1, 2147483650]); // Huawei negative ifIndex fixed from the row key
    const intl = docs[0];
    expect(intl).toMatchObject({
      ifName: 'GigabitEthernet0/0/1',
      name: 'GigabitEthernet0/0/1',
      ifAlias: HUAWEI_ALIAS,
      ifIndex: 1,
      index: 1,
      ifType: 6,
      ifTypeStr: 'ethernet-csmacd',
      ifSpeed: 1e9,
      ifHighSpeed: 1000,
      adminStatus: 'up',
      operStatus: 'up',
      ifHCInOctets: 10,
      ifHCOutOctets: 20,
      specialService: 'International',
      sp_provider: 'Cogent',
      sp_linkNumber: 'L22',
      sp_speed: 10e9,
      sp_speedText: '10 Gbps',
      ifSpeedText: '1 Gbps',
      speedCat: '10G',
      unknownFlag: 0,
      hostname: 'DUBP-RHH1-DUB-01',
      ipaddress: '10.10.0.1',
      pop: 'DUBP',
      devType: 'Router',
      devVendor: 'Huawei',
      devModel: 'NE40',
      devCty: 'DUB',
      devSector: 'North',
      // from the Link collection
      secondHost: 'CORP-MZZ1-COR-01',
      secondInterface: 'ge-0/1/1',
      secondPOP: 'CORP',
      type: 'WAN',
      syncCycles: 0,
      delete: false,
    });
    expect(intl.lastSyncTime.toISOString()).toBe('2024-05-01T10:00:00.000Z');
    expect(intl.counters).toEqual({
      ifHCInOctets: 10,
      ifHCOutOctets: 20,
      at: new Date('2024-05-01T10:00:00Z'),
    });
    expect(intl.author.email).toBe('seed@example.com');
    expect(String(intl.device.id)).toBe(String(huawei._id));

    const zte = await Interface.find({ hostname: 'CORP-MZZ1-COR-01' }).sort({ ifIndex: 1 });
    expect(zte.map((d) => d.ifName)).toEqual(['ge-0/1/1', 'xe-0/2/1', 'ge-0/1/3']); // subscriber ports dropped
    expect(zte[0]).toMatchObject({ ifSpeed: 1e9, ifHighSpeed: 1000, ifSpeedText: '1 Gbps' }); // ifHighSpeed derived
    expect(zte[1]).toMatchObject({
      ifSpeed: 10e9,
      ifHighSpeed: 10000,
      specialService: 'ESP',
      sp_customer: 'BT_ACCESS',
    }); // saturated ifSpeed fixed
    expect(zte[2]).toMatchObject({ ifSpeed: 1e9, ifHighSpeed: 1000 }); // bit/s -> Mbit/s
    expect(await Interface.countDocuments({ hostname: 'GALP-RCJ1-GAL-01' })).toBe(0);
  });

  test('raw rows are stored unparsed in the rawinterface collection', async () => {
    const { RawInterface } = app.models;
    const raw = await RawInterface.find({ hostname: 'DUBP-RHH1-DUB-01' })
      .sort({ ifIndex: 1 })
      .lean();
    expect(raw.map((r) => r.ifIndex)).toEqual([1, 3, 4, 5, 2147483650]);
    const negative = raw.find((r) => r.ifIndex === 2147483650);
    expect(negative.columns.ifIndex).toBe(-2147483646); // exactly as reported, before the Huawei workaround
    expect(negative.columns.rowKey).toBe('2147483650');
    expect(raw[0]).toMatchObject({
      ipaddress: '10.10.0.1',
      vendor: 'huawei',
      sys: { sysName: 'DUBP-RHH1-DUB-01' },
      columns: {
        ifName: 'GigabitEthernet0/0/1',
        ifAlias: HUAWEI_ALIAS,
        ifType: 6,
        ifAdminStatus: 1,
      },
    });
    expect(String(raw[0].deviceId)).toBe(String(huawei._id));
    expect(await RawInterface.countDocuments({ hostname: 'CORP-MZZ1-COR-01' })).toBe(5); // subscriber ports kept raw
    expect(await RawInterface.countDocuments({ hostname: 'GALP-RCJ1-GAL-01' })).toBe(0);
  });

  test('POP data (sheet) is copied onto the device and its interfaces during sync', async () => {
    const { Device, Interface } = app.models;
    const dev = await Device.findById(huawei._id);
    expect(dev).toMatchObject({
      pop: 'DUBP',
      popLongName: 'Dublin main POP',
      cty: 'DUB',
      district: 'Downtown',
      popType: 'Core',
    });
    expect(dev.sector.name).toBe('North');
    const intf = await Interface.findOne({ hostname: 'DUBP-RHH1-DUB-01', ifIndex: 1 });
    expect(intf).toMatchObject({
      pop: 'DUBP',
      devPOP: 'DUBP',
      devPOPLongName: 'Dublin main POP',
      devCty: 'DUB',
      devDistrict: 'Downtown',
      devSector: 'North',
      devPOPType: 'Core',
    });
    expect(dev.interfaces[0].devPOPLongName).toBe('Dublin main POP');
    // a device without a matching POP keeps its own values
    const zte = await Device.findById(zteMsan._id);
    expect(zte.pop).toBe('COR');
    expect(zte.popLongName).toBe('Unkown');
  });

  test('devices get sys*, lastSyncTime, deviceSyncCycles and the embedded interfaces', async () => {
    const { Device } = app.models;
    const dev = await Device.findById(huawei._id);
    expect(dev).toMatchObject({
      sysDescr: 'Huawei Versatile Routing Platform',
      sysObjectID: '1.3.6.1.4.1.2011.2.62.1',
      sysName: 'DUBP-RHH1-DUB-01',
      discovered: true,
      deviceSyncCycles: 1,
    });
    expect(dev.lastSyncTime.toISOString()).toBe('2024-05-01T10:00:00.000Z');
    expect(dev.interfaces.map((i) => i.ifName)).toEqual([
      'GigabitEthernet0/0/1',
      'GigabitEthernet0/0/2',
    ]);
    const failed = await Device.findById(broken._id);
    expect(failed.deviceSyncCycles).toBe(0);
    expect(failed.lastSyncTime).toBeUndefined();
  });

  test('a second run updates instead of duplicating, and flags interfaces that disappeared', async () => {
    const { Interface, Device } = app.models;
    // the second Huawei interface disappears, the first one changes its alias
    const rows = fixtures['10.10.0.1'].tables;
    delete rows[OIDS.ifTable.oid]['2147483650'];
    delete rows[OIDS.ifXTable.oid]['2147483650'];
    rows[OIDS.ifXTable.oid]['1'][IFX.ifAlias] = Buffer.from('THREE-ALPHA-BITSTREAM L1 GIG');

    const second = await syncDevices([huawei, zteMsan], {
      createSession,
      concurrency: 1,
      cyclesThreshold: 1,
    });
    expect(second).toMatchObject({ total: 2, ok: 2, failed: 0 });
    const huaweiResult = second.results.find((r) => r.hostname === 'DUBP-RHH1-DUB-01');
    expect(huaweiResult.interfaces).toMatchObject({
      interesting: 1,
      created: 0,
      updated: 1,
      missing: 1,
      flagged: 0,
    });

    expect(await Interface.countDocuments({ hostname: 'DUBP-RHH1-DUB-01' })).toBe(2); // no duplicates
    const updated = await Interface.findOne({ hostname: 'DUBP-RHH1-DUB-01', ifIndex: 1 });
    expect(updated).toMatchObject({
      specialService: 'Bitstream',
      sp_customer: 'THREE',
      sp_provider: 'Unknown',
      syncCycles: 0,
    });
    const missing = await Interface.findOne({ hostname: 'DUBP-RHH1-DUB-01', ifIndex: 2147483650 });
    expect(missing).toMatchObject({ syncCycles: 1, delete: false });

    // third run: missed again -> beyond the threshold -> flagged for deletion
    const third = await syncDevices([huawei], { createSession, cyclesThreshold: 1 });
    expect(third.results[0].interfaces).toMatchObject({ missing: 1, flagged: 1 });
    expect(
      (await Interface.findOne({ hostname: 'DUBP-RHH1-DUB-01', ifIndex: 2147483650 })).delete
    ).toBe(true);
    expect((await Device.findById(huawei._id)).deviceSyncCycles).toBe(3);
    expect(await Interface.countDocuments({ hostname: 'CORP-MZZ1-COR-01' })).toBe(3);
  });

  test('a null session (device without IP) is reported, not thrown', async () => {
    const { Device } = app.models;
    const noIp = await Device.create({
      hostname: 'NOIP-RCJ1-DUB-09',
      ipaddress: undefined,
      type: 'Router',
    });
    const run = await syncDevices([noIp], {
      createSession: require('../services/snmpSession').createSession,
    });
    expect(run.results[0]).toMatchObject({ ok: false, errorName: 'SnmpSessionError' });
    expect(run.results[0].error).toMatch(/no IP address/);
  });
});

describe('interest rules and vendor detection', () => {
  test('isInterestingInterface applies the original discovery rules', () => {
    const base = { ifAdminStatus: 1, ifOperStatus: 1, ifDescr: 'x', ifName: '', ifAlias: '' };
    expect(isInterestingInterface({ ...base, ifName: 'ge-0/0/0' })).toBe(true);
    expect(isInterestingInterface({ ...base, ifName: 'Bundle-Ether1' })).toBe(true);
    expect(isInterestingInterface({ ...base, ifName: '1/2/3' })).toBe(true);
    expect(isInterestingInterface({ ...base, ifName: 'ge-0/0/0.100' })).toBe(false); // sub-interface
    expect(isInterestingInterface({ ...base, ifName: 'Loopback0', ifAlias: 'NR_x' })).toBe(true); // alias rule
    expect(isInterestingInterface({ ...base, ifName: 'ge-0/0/0', ifOperStatus: 2 })).toBe(false);
    expect(isInterestingInterface({ ...base, ifName: 'ge-0/0/0', ifDescr: 'MPLS' })).toBe(false);
    expect(isInterestingInterface({ ...base, ifName: 'galway-1' })).toBe(false);
  });

  test('vendors are detected from sysObjectID, then sysDescr / device.vendor', () => {
    expect(vendors.detect({}, { sysObjectID: '1.3.6.1.4.1.2011.2.1' }).name).toBe('huawei');
    expect(vendors.detect({}, { sysObjectID: '1.3.6.1.4.1.3902.3' }).name).toBe('zte');
    expect(vendors.detect({}, { sysObjectID: '1.3.6.1.4.1.637.61.1' }).name).toBe('alcatelsiemens');
    expect(vendors.detect({}, { sysObjectID: '1.3.6.1.4.1.2636.1.1.1.2' }).name).toBe('juniper');
    expect(vendors.detect({ vendor: 'Juniper' }, {}).name).toBe('juniper');
    expect(vendors.detect({}, { sysDescr: 'Cisco IOS' }).name).toBe('generic');
    expect(vendors.detect({}, {}).name).toBe('generic');
  });
});

describe('sync routes', () => {
  test('GET /devices/sync/status returns the runner status as JSON', async () => {
    const res = await agent.get('/devices/sync/status').expect(200).expect('content-type', /json/);
    expect(res.body).toHaveProperty('running');
    expect(res.body).toHaveProperty('lastRun');
  });

  test('GET /devices/sync and /devices/sync/:id start a background run and redirect', async () => {
    await agent.get('/devices/sync/' + new app.mongoose.Types.ObjectId()).expect(404);
    await agent
      .get('/devices/sync/' + broken._id)
      .expect(302)
      .expect('location', '/devices');
    const status = await agent.get('/devices/sync/status').expect(200);
    expect(status.body.running).toMatchObject({ total: 1 });
    // a second request while running is refused politely
    await agent.get('/devices/sync').expect(302).expect('location', '/devices');
  });
});

describe('IIB community rule (COMMUNITY_KEY1 -> COMMUNITY_VALUE1)', () => {
  test('a device whose community is the placeholder is polled with the real string', async () => {
    const { Device } = app.models;
    const iib = await Device.create({
      hostname: 'IIBP-RCJ1-DUB-07',
      ipaddress: '10.10.0.7',
      community: 'iib-placeholder',
      type: 'Router',
    });
    const localStats = { created: [], closed: 0, active: 0, maxActive: 0 };
    const factory = fakeSessionFactory(
      { '10.10.0.7': { sys: {}, tables: {}, fail: timeoutError() } },
      localStats
    );
    await syncDevices([iib], { createSession: factory });
    expect(localStats.created[0].community).toBe('real-secret-community');
    // the placeholder is what stays stored
    expect((await Device.findById(iib._id)).community).toBe('iib-placeholder');
    // a community sent with the request (?community=) goes through the same swap
    await syncDevices([iib], { createSession: factory, community: 'iib-placeholder' });
    expect(localStats.created[1].community).toBe('real-secret-community');
    await syncDevices([iib], { createSession: factory, community: 'other' });
    expect(localStats.created[2].community).toBe('other');
  });

  test('vendors.community swaps only exact placeholders and keeps normal communities', () => {
    expect(vendors.community({ community: 'iib-placeholder' }, 'public')).toBe(
      'real-secret-community'
    );
    expect(vendors.community({ community: 'public' }, 'public')).toBe('public');
    expect(vendors.community({}, 'public')).toBe('public');
    expect(vendors.community({ communityString: 'legacy' }, 'public')).toBe('legacy');
  });
});

describe('special Juniper devices (ONGAR-R39J-D-IR, AUTO-R38J-WIK-IR)', () => {
  test('are detected from the hostname vendor code and get the long session timeouts', () => {
    for (const hostname of ['ONGAR-R39J-D-IR', 'auto-r38j-wik-ir']) {
      expect(vendors.juniper.isSpecialDevice({ hostname })).toBe(true);
      expect(vendors.sessionOptions({ hostname })).toEqual({ timeoutMs: 300000, retries: 10 });
      expect(vendors.detect({ hostname }, {}).name).toBe('juniper'); // "J" vendor code in the name
    }
    expect(vendors.juniper.isSpecialDevice({ hostname: 'DUBP-R01J-DUB-01' })).toBe(false);
    expect(vendors.sessionOptions({ hostname: 'DUBP-R01J-DUB-01' })).toEqual({});
    expect(vendors.detect({ hostname: 'DUBP-R01J-DUB-01' }, {}).name).toBe('juniper');
  });

  test('keep only up interfaces with a non-empty ifDescr without "." (sub-interfaces skipped)', async () => {
    const { Device, Interface } = app.models;
    const special = await Device.create({
      hostname: 'ONGAR-R39J-D-IR',
      ipaddress: '10.10.0.8',
      community: 'c',
      type: 'Router',
    });
    const regular = await Device.create({
      hostname: 'DUBP-R01J-DUB-01',
      ipaddress: '10.10.0.9',
      community: 'c',
      type: 'Router',
    });
    const juniperRows = [
      row(1, {
        descr: 'ge-0/0/0',
        name: 'ge-0/0/0',
        alias: 'INT-IPT-Cogent-DUB-10GIG-B2-NB-L22-1_300050661-EIG_IPT_10G_0019-EIG',
      }),
      row(2, {
        descr: 'ge-0/0/0.0',
        name: 'ge-0/0/0.0',
        alias: 'INT-IPT-Cogent-DUB-10GIG-B2-NB-L22-1_300050661-EIG_IPT_10G_0019-EIG',
      }), // sub-interface
      row(3, { descr: '', name: 'ge-0/0/3', alias: 'NR_Lycka_Data_ALZ_AUTO-N01E-DSR-IR L1 GIG' }), // empty ifDescr
      row(4, { descr: 'ge-0/0/4', name: 'ge-0/0/4', alias: 'THREE-BITSTREAM L6 1GIG', oper: 2 }), // down
    ];
    const sys = {
      [OIDS.sysDescr]: Buffer.from('Juniper Networks, Inc. mx480'),
      [OIDS.sysObjectID]: '1.3.6.1.4.1.2636.1.1.1.2.25',
      [OIDS.sysName]: Buffer.from('x'),
    };
    const localStats = { created: [], closed: 0, active: 0, maxActive: 0 };
    const factory = fakeSessionFactory(
      {
        '10.10.0.8': { sys, tables: tables(juniperRows) },
        '10.10.0.9': { sys, tables: tables(juniperRows) },
      },
      localStats
    );
    const run = await syncDevices([special, regular], { createSession: factory });
    expect(run.ok).toBe(2);
    expect(localStats.created.find((c) => c.host === '10.10.0.8')).toMatchObject({
      timeoutMs: 300000,
      retries: 10,
    });
    expect(localStats.created.find((c) => c.host === '10.10.0.9').timeoutMs).toBeUndefined();
    // special device: only ge-0/0/0 survives (sub-interface, empty ifDescr and down rows skipped)
    expect((await Interface.find({ hostname: 'ONGAR-R39J-D-IR' })).map((i) => i.ifName)).toEqual([
      'ge-0/0/0',
    ]);
    // regular device: only "up" is required at the ifTable stage; the alias rules then keep the NR_ one as well
    expect(
      (await Interface.find({ hostname: 'DUBP-R01J-DUB-01' }).sort({ ifIndex: 1 })).map(
        (i) => i.ifName
      )
    ).toEqual(['ge-0/0/0', 'ge-0/0/0.0', 'ge-0/0/3']);
  });
});
