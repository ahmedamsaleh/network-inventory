/**
 * BTMSANInfo + MSAN/GPON rules during sync (mocked SNMP sessions):
 *  - BT fields by management IP (device + every interface; "Unknown" otherwise),
 *  - device class: GPON from the hostname code, MSAN from the stored type or
 *    the Alcatel -MnnN- rule,
 *  - access devices keep only ifType 6/117 interfaces that show traffic,
 *  - parent POP (shortName_cty, cabinet lookup applied) from MSAN/GPON/Router
 *    link partners, secondDeviceType for every linked interface.
 */
const { bootApp, adminAgent } = require('./helpers/boot');

let app;
let syncDevices;
let OIDS;
let IF;
let IFX;

function row(index, { name, type = 6, inOctets = 0, outOctets = 0, alias = '' }) {
  return {
    key: String(index),
    ifTable: {
      [IF.ifIndex]: index,
      [IF.ifDescr]: name,
      [IF.ifType]: type,
      [IF.ifSpeed]: 1e9,
      [IF.ifAdminStatus]: 1,
      [IF.ifOperStatus]: 1,
    },
    ifXTable: {
      [IFX.ifName]: name,
      [IFX.ifAlias]: alias,
      [IFX.ifHighSpeed]: 1000,
      [IFX.ifHCInOctets]: inOctets,
      [IFX.ifHCOutOctets]: outOctets,
    },
  };
}

function fixture(sysObjectID, sysDescr, rows) {
  const ifTable = {};
  const ifXTable = {};
  for (const r of rows) {
    ifTable[r.key] = r.ifTable;
    ifXTable[r.key] = r.ifXTable;
  }
  return {
    sys: { [OIDS.sysDescr]: sysDescr, [OIDS.sysObjectID]: sysObjectID, [OIDS.sysName]: 'x' },
    tables: { [OIDS.ifTable.oid]: ifTable, [OIDS.ifXTable.oid]: ifXTable },
  };
}

function sessionFactory(fixtures) {
  return ({ host }) => {
    const f = fixtures[host];
    return {
      isNull: !f,
      error: f ? null : new Error('no fixture'),
      async get(oids) {
        return Object.fromEntries(oids.map((oid) => [oid, f.sys[oid]]));
      },
      async tableColumns(oid) {
        return f.tables[oid];
      },
      close() {},
    };
  };
}

beforeAll(async () => {
  app = await bootApp();
  await adminAgent(app);
  ({ syncDevices } = require('../services/syncRunner'));
  ({ OIDS } = require('../services/syncDevice'));
  IF = OIDS.ifTable.columns;
  IFX = OIDS.ifXTable.columns;
});

afterAll(async () => {
  await app.close();
});

describe('MSAN / GPON sync rules', () => {
  let msan;
  let gpon;
  let router;
  let run;

  beforeAll(async () => {
    const { POP, Cabinet, Device, Link, BTMSANInfo } = app.models;
    await POP.create({ name: 'Dublin POP', shortName: 'DUBP', cty: 'DUB' }); // pop_cty DUBP_DUB
    await POP.create({ name: 'Cork POP', shortName: 'CORP', cty: 'COR' }); // pop_cty CORP_COR
    await POP.create({ name: 'Galway POP', shortName: 'GALP', cty: 'GAL' });
    await Cabinet.create({ cabinet: 'CORM', pop: 'CORP' }); // cabinet of the MSAN -> POP CORP

    router = await Device.create({
      hostname: 'DUBP-RHH1-DUB-01',
      ipaddress: '10.40.0.9',
      community: 'c',
      type: 'Router',
      vendor: 'Huawei',
    });
    // Alcatel device with -M01N- in the hostname: forced to MSAN although no type is stored
    msan = await Device.create({
      hostname: 'CORM-M01N-COR-01',
      ipaddress: '10.40.0.1',
      community: 'c',
      type: '',
      vendor: 'Alcatel',
      btMSANCode: 'TYPED-BY-HAND',
    });
    // GPON from the hostname type code G; no BT row for its IP, hand-typed BT code must become Unknown
    gpon = await Device.create({
      hostname: 'GALP-G01H-GAL-01',
      ipaddress: '10.40.0.2',
      community: 'c',
      type: '',
      vendor: 'Huawei',
      btMSANCode: 'TYPED-BY-HAND',
    });
    await BTMSANInfo.create({
      msanCode: 'MSAN-COR-001',
      mngIP: '10.40.0.1',
      sector: 'East',
      district: 'Smouha',
    });
    await BTMSANInfo.create({
      msanCode: 'MSAN-OTHER',
      mngIP: '10.40.0.99',
      sector: 'x',
      district: 'y',
    });

    await Link.create({
      device1: 'CORM-M01N-COR-01',
      interface1: 'ge-0/1/1',
      device2: 'DUBP-RHH1-DUB-01',
      interface2: 'GigabitEthernet0/0/1',
    }); // MSAN <-> Router
    await Link.create({
      device1: 'CORM-M01N-COR-01',
      interface1: 'ge-0/1/2',
      device2: 'GALP-SCJ1-GAL-02',
      interface2: 'ge-0/0/1',
    }); // MSAN <-> Switch (not in the DB)
    await Link.create({
      device1: 'GALP-G01H-GAL-01',
      interface1: 'ge-0/1/1',
      device2: 'CORM-M01N-COR-01',
      interface2: 'ge-0/1/9',
    }); // GPON <-> MSAN

    const fixtures = {
      '10.40.0.9': fixture('1.3.6.1.4.1.2011.2.62.1', 'Huawei VRP', [
        row(1, { name: 'GigabitEthernet0/0/1', inOctets: 5 }),
      ]),
      '10.40.0.1': fixture('1.3.6.1.4.1.637.61.1', 'ISAM', [
        row(1, { name: 'ge-0/1/1', type: 6, inOctets: 100 }), // kept: ethernet with traffic, linked to a Router
        row(2, { name: 'ge-0/1/2', type: 117, outOctets: 7 }), // kept: gigabitEthernet with traffic, linked to a Switch
        row(3, { name: 'ge-0/1/3', type: 6 }), // dropped: no traffic
        row(4, { name: 'ge-0/1/4', type: 94, inOctets: 50 }), // dropped: adsl
        row(5, { name: 'some-odd-port-name', type: 6, inOctets: 1 }), // kept: the name does not matter on an MSAN
      ]),
      '10.40.0.2': fixture('1.3.6.1.4.1.2011.2.62.1', 'Huawei MA5800', [
        row(1, { name: 'ge-0/1/1', type: 117, inOctets: 3 }),
      ]),
    };
    run = await syncDevices([router, msan, gpon], {
      createSession: sessionFactory(fixtures),
      concurrency: 1,
    });
  });

  test('all three devices sync; classes and BT lookups are reported', () => {
    expect(run).toMatchObject({ total: 3, ok: 3, failed: 0 });
    const byHost = Object.fromEntries(run.results.map((r) => [r.hostname, r]));
    expect(byHost['CORM-M01N-COR-01']).toMatchObject({
      deviceClass: 'MSAN',
      btMSANCode: 'MSAN-COR-001',
      interfaces: { total: 5, interesting: 3 },
    });
    expect(byHost['GALP-G01H-GAL-01']).toMatchObject({
      deviceClass: 'GPON',
      btMSANCode: 'Unknown',
      interfaces: { interesting: 1 },
    });
    expect(byHost['DUBP-RHH1-DUB-01']).toMatchObject({
      deviceClass: 'Router',
      btMSANCode: 'Unknown',
    });
  });

  test('BT fields come from the row matching the management IP, on the device and every interface', async () => {
    const { Device, Interface } = app.models;
    const m = await Device.findById(msan._id);
    expect(m).toMatchObject({
      type: 'MSAN',
      btMSANCode: 'MSAN-COR-001',
      btMngIP: '10.40.0.1',
      btSector: 'East',
      btDistrict: 'Smouha',
    });
    const msanInterfaces = await Interface.find({ hostname: 'CORM-M01N-COR-01' }).sort({
      ifIndex: 1,
    });
    expect(msanInterfaces.map((i) => i.ifName)).toEqual([
      'ge-0/1/1',
      'ge-0/1/2',
      'some-odd-port-name',
    ]);
    for (const intf of msanInterfaces) {
      expect(intf).toMatchObject({
        btMSANCode: 'MSAN-COR-001',
        btMngIP: '10.40.0.1',
        btSector: 'East',
        btDistrict: 'Smouha',
        devType: 'MSAN',
      });
    }
    // no row for the GPON / router IPs -> Unknown, the hand-typed code is overwritten
    expect(await Device.findById(gpon._id)).toMatchObject({
      type: 'GPON',
      btMSANCode: 'Unknown',
      btMngIP: 'Unknown',
      btSector: 'Unknown',
      btDistrict: 'Unknown',
    });
    expect(await Device.findById(router._id)).toMatchObject({
      type: 'Router',
      btMSANCode: 'Unknown',
    });
    expect(await Interface.findOne({ hostname: 'GALP-G01H-GAL-01' })).toMatchObject({
      btMSANCode: 'Unknown',
      devType: 'GPON',
    });
  });

  test('parent POP: MSAN/GPON interfaces linked to a Router/MSAN take the partner POP (shortName_cty, cabinet applied)', async () => {
    const { Interface } = app.models;
    const toRouter = await Interface.findOne({ hostname: 'CORM-M01N-COR-01', ifName: 'ge-0/1/1' });
    expect(toRouter).toMatchObject({
      parentPOP: 'DUBP_DUB',
      secondPOP: 'DUBP_DUB',
      secondHost: 'DUBP-RHH1-DUB-01',
      secondDeviceType: 'Router',
    });
    const toSwitch = await Interface.findOne({ hostname: 'CORM-M01N-COR-01', ifName: 'ge-0/1/2' });
    expect(toSwitch).toMatchObject({
      parentPOP: '',
      secondPOP: 'GALP',
      secondDeviceType: 'Switch',
    }); // switch partner: no parent POP
    const unlinked = await Interface.findOne({
      hostname: 'CORM-M01N-COR-01',
      ifName: 'some-odd-port-name',
    });
    expect(unlinked.parentPOP).toBe('');
    expect(unlinked.secondDeviceType).toBeFalsy(); // no link data
    // GPON -> MSAN partner whose POP is resolved through its cabinet (CORM -> CORP)
    const gponIntf = await Interface.findOne({ hostname: 'GALP-G01H-GAL-01' });
    expect(gponIntf).toMatchObject({
      parentPOP: 'CORP_COR',
      secondPOP: 'CORP_COR',
      secondDeviceType: 'MSAN',
    });
    // a router uplink facing the MSAN only gets secondDeviceType; its secondPOP stays the hostname-parsed one
    const uplink = await Interface.findOne({ hostname: 'DUBP-RHH1-DUB-01' });
    expect(uplink).toMatchObject({ secondDeviceType: 'MSAN', secondPOP: 'CORM', parentPOP: '' });
  });

  test('classification helpers', () => {
    const {
      classifyDevice,
      isAccessDevice,
      isParentPopPartner,
    } = require('../services/deviceClass');
    expect(classifyDevice({ hostname: 'ONGAR-M01N-D-IR', vendor: 'Alcatel-Lucent' })).toBe('MSAN');
    expect(classifyDevice({ hostname: 'ONGAR-M01N-D-IR', vendor: 'Huawei' })).toBe('MSAN'); // stored type wins? no: hostname code M -> MSAN
    expect(classifyDevice({ hostname: 'ONGAR-R01N-D-IR', vendor: 'Alcatel', type: '' })).toBe(
      'Router'
    ); // -RnnN-: not the MSAN rule
    expect(classifyDevice({ hostname: 'ONGAR-G01H-D-IR', type: 'Router' })).toBe('GPON'); // hostname GPON wins
    expect(classifyDevice({ hostname: 'anything', type: 'MSAN' })).toBe('MSAN');
    expect(classifyDevice({ hostname: 'anything', type: 'Switch' })).toBe('Switch');
    expect(classifyDevice({ hostname: 'X-SCJ1-Y-01' })).toBe('Switch');
    expect(classifyDevice(null)).toBe('');
    for (const cls of ['MSAN', 'GPON', 'DSLAM', 'Controller', 'DPI'])
      expect(isAccessDevice(cls)).toBe(true);
    expect(isAccessDevice('Router')).toBe(false);
    expect(isParentPopPartner('Router')).toBe(true);
    expect(isParentPopPartner('Switch')).toBe(false);
  });
});
