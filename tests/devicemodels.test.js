/**
 * CRUD for /devicemodels and vendor/type resolution (sysObjectID or model
 * name) during sync, device import and device creation.
 */
const { bootApp, adminAgent } = require('./helpers/boot');

let app;
let agent;

beforeAll(async () => {
  app = await bootApp();
  agent = await adminAgent(app);
});

afterAll(async () => {
  await app.close();
});

describe('DeviceModel CRUD (authenticated)', () => {
  let id;

  test('all routes are guarded', async () => {
    const fake = new app.mongoose.Types.ObjectId();
    for (const url of [
      '/devicemodels',
      '/devicemodels/pagination',
      '/devicemodels/new',
      '/devicemodels/' + fake,
      '/devicemodels/' + fake + '/edit',
    ]) {
      await app.anon().get(url).expect(302).expect('location', '/login');
    }
    await app
      .anon()
      .post('/devicemodels')
      .type('form')
      .send({})
      .expect(302)
      .expect('location', '/login');
    await app
      .anon()
      .put('/devicemodels/' + fake)
      .type('form')
      .send({})
      .expect(302)
      .expect('location', '/login');
    await app
      .anon()
      .delete('/devicemodels/' + fake)
      .expect(302)
      .expect('location', '/login');
  });

  test('INDEX / NEW render', async () => {
    const index = await agent.get('/devicemodels').expect(200);
    expect(index.text).toContain('data-url="/devicemodels/pagination"');
    expect(index.text).toContain('href="/devicemodels"'); // header link
    const form = await agent.get('/devicemodels/new').expect(200);
    for (const field of ['name', 'vendor', 'type', 'sysObjectIDs', 'notes'])
      expect(form.text).toContain(`name="devicemodel[${field}]"`);
    expect(form.text).toContain('<option value="MSAN"');
  });

  test('CREATE parses the sysObjectID list (one per line / commas, leading dot, duplicates, junk)', async () => {
    await agent
      .post('/devicemodels')
      .type('form')
      .send({
        'devicemodel[name]': ' MX480 ',
        'devicemodel[vendor]': 'Juniper',
        'devicemodel[type]': 'Router',
        'devicemodel[sysObjectIDs]':
          '1.3.6.1.4.1.2636.1.1.1.2.25\n.1.3.6.1.4.1.2636.1.1.1.2.25, 1.3.6.1.4.1.2636.1.1.1.2.26\nnot-an-oid',
      })
      .expect(302)
      .expect('location', '/devicemodels');
    const model = await app.models.DeviceModel.findOne({ name: 'MX480' });
    expect(model).toMatchObject({
      vendor: 'Juniper',
      type: 'Router',
      sysObjectIDs: ['1.3.6.1.4.1.2636.1.1.1.2.25', '1.3.6.1.4.1.2636.1.1.1.2.26'],
    });
    expect(model.author.email).toBe('admin@example.com');
    id = String(model._id);
    // missing name / duplicate name -> back to the form
    await agent
      .post('/devicemodels')
      .type('form')
      .send({ 'devicemodel[vendor]': 'x' })
      .expect(302)
      .expect('location', '/devicemodels/new');
    await agent
      .post('/devicemodels')
      .type('form')
      .send({ 'devicemodel[name]': 'mx480' })
      .expect(302)
      .expect('location', '/devicemodels/new');
    expect(await app.models.DeviceModel.countDocuments({})).toBe(1);
  });

  test('SHOW / EDIT / UPDATE / PAGINATION / 404 / DESTROY', async () => {
    expect((await agent.get('/devicemodels/' + id).expect(200)).text).toContain(
      '1.3.6.1.4.1.2636.1.1.1.2.25'
    );
    expect((await agent.get('/devicemodels/' + id + '/edit').expect(200)).text).toContain(
      'value="MX480"'
    );
    await agent.get('/devicemodels/' + new app.mongoose.Types.ObjectId()).expect(404);
    await agent.get('/devicemodels/nope/edit').expect(404);
    await agent
      .put('/devicemodels/' + id)
      .type('form')
      .send({
        'devicemodel[type]': 'Switch',
        'devicemodel[sysObjectIDs]': '1.3.6.1.4.1.2636.1.1.1.2.25',
      })
      .expect(302)
      .expect('location', '/devicemodels/' + id);
    const updated = await app.models.DeviceModel.findById(id);
    expect(updated).toMatchObject({
      type: 'Switch',
      sysObjectIDs: ['1.3.6.1.4.1.2636.1.1.1.2.25'],
    });
    expect(updated.lastUpdate).toBeInstanceOf(Date);
    const page = await agent.get('/devicemodels/pagination').query({ search: '2636' }).expect(200);
    expect(page.body.total).toBe(1);
    expect(page.body.rows[0]).toMatchObject({
      name: 'MX480',
      vendor: 'Juniper',
      type: 'Switch',
      sysObjectIDs: '1.3.6.1.4.1.2636.1.1.1.2.25',
    });
    await agent
      .delete('/devicemodels/' + id)
      .expect(302)
      .expect('location', '/devicemodels');
    expect(await app.models.DeviceModel.findById(id)).toBeNull();
  });
});

describe('vendor / type resolution', () => {
  beforeAll(async () => {
    const { DeviceModel } = app.models;
    await DeviceModel.create({
      name: 'NE40E',
      vendor: 'Huawei',
      type: 'Router',
      sysObjectIDs: ['1.3.6.1.4.1.2011.2.62'],
    }); // subtree
    await DeviceModel.create({
      name: 'NE40E-X8',
      vendor: 'Huawei',
      type: 'Router',
      sysObjectIDs: ['1.3.6.1.4.1.2011.2.62.1'],
    }); // more specific
    await DeviceModel.create({
      name: 'C300',
      vendor: 'ZTE',
      type: 'MSAN',
      sysObjectIDs: ['1.3.6.1.4.1.3902.1082'],
    });
    await DeviceModel.create({ name: 'EX4300', vendor: 'Juniper', type: 'Switch' }); // by name only
  });

  test('DeviceModel.resolve: longest sysObjectID prefix wins, then model name', async () => {
    const { DeviceModel } = app.models;
    expect(await DeviceModel.resolve({ sysObjectID: '1.3.6.1.4.1.2011.2.62.1.7' })).toMatchObject({
      model: 'NE40E-X8',
      vendor: 'Huawei',
      matchedBy: 'sysObjectID',
    });
    expect(await DeviceModel.resolve({ sysObjectID: '1.3.6.1.4.1.2011.2.62.9' })).toMatchObject({
      model: 'NE40E',
      matchedBy: 'sysObjectID',
    });
    expect(await DeviceModel.resolve({ sysObjectID: '1.3.6.1.4.1.2011.2.620' })).toBeNull(); // not a subtree match
    expect(
      await DeviceModel.resolve({ sysObjectID: '1.3.6.1.4.1.9.1.1', model: 'ex4300' })
    ).toMatchObject({ model: 'EX4300', type: 'Switch', matchedBy: 'model' });
    expect(await DeviceModel.resolve({ model: 'unknown-model' })).toBeNull();
    expect(await DeviceModel.resolve({})).toBeNull();
  });

  test('syncing a device whose sysObjectID matches fills in vendor and type (and the interfaces inherit them)', async () => {
    const { Device, Interface } = app.models;
    const { syncDevices } = require('../services/syncRunner');
    const { OIDS } = require('../services/syncDevice');
    const IF = OIDS.ifTable.columns;
    const IFX = OIDS.ifXTable.columns;
    const device = await Device.create({
      hostname: 'DUBP-RHH9-DUB-09',
      ipaddress: '10.30.0.1',
      community: 'c',
      vendor: '',
      type: '',
    });
    const sys = {
      [OIDS.sysDescr]: 'Huawei VRP',
      [OIDS.sysObjectID]: '1.3.6.1.4.1.2011.2.62.1.7',
      [OIDS.sysName]: 'DUBP-RHH9-DUB-09',
    };
    const tables = {
      [OIDS.ifTable.oid]: {
        1: {
          [IF.ifIndex]: 1,
          [IF.ifDescr]: 'ge-0/0/0',
          [IF.ifType]: 6,
          [IF.ifSpeed]: 1e9,
          [IF.ifAdminStatus]: 1,
          [IF.ifOperStatus]: 1,
        },
      },
      [OIDS.ifXTable.oid]: {
        1: { [IFX.ifName]: 'ge-0/0/0', [IFX.ifAlias]: 'uplink', [IFX.ifHighSpeed]: 1000 },
      },
    };
    const createSession = () => ({
      isNull: false,
      error: null,
      async get(oids) {
        return Object.fromEntries(oids.map((oid) => [oid, sys[oid]]));
      },
      async tableColumns(oid) {
        return tables[oid];
      },
      close() {},
    });
    const run = await syncDevices([device], { createSession });
    expect(run.results[0]).toMatchObject({
      ok: true,
      vendor: 'huawei',
      deviceModel: { vendor: 'Huawei', type: 'Router', model: 'NE40E-X8' },
    });
    const synced = await Device.findById(device._id);
    expect(synced).toMatchObject({
      vendor: 'Huawei',
      type: 'Router',
      model: 'NE40E-X8',
      sysObjectID: '1.3.6.1.4.1.2011.2.62.1.7',
    });
    const intf = await Interface.findOne({ hostname: 'DUBP-RHH9-DUB-09', ifIndex: 1 });
    expect(intf).toMatchObject({ devVendor: 'Huawei', devType: 'Router', devModel: 'NE40E-X8' });
    // sysObjectID is authoritative: a wrong manual vendor/type is corrected on the next sync
    await Device.updateOne({ _id: device._id }, { $set: { vendor: 'Cisco', type: 'Switch' } });
    await syncDevices([device], { createSession });
    expect(await Device.findById(device._id)).toMatchObject({ vendor: 'Huawei', type: 'Router' });
  });

  test('device import fills vendor/type from the model name; device creation fills blanks', async () => {
    const { Device } = app.models;
    const importEnrichment = require('../middleware/import_enrichment');
    const fields = require('../lookUps/enrich').extendedEnrichmentFields;
    const row = fields.map((f, i) =>
      i === 12
        ? 'IMPP-RCJ1-DUB-11'
        : i === 13
          ? '10.30.0.11'
          : i === 14
            ? 'ex4300'
            : i === 0
              ? 'x'
              : ''
    );
    const file = importEnrichment.uploadPath('models-import.csv');
    require('fs').writeFileSync(file, fields.join(',') + '\n' + row.join(',') + '\n');
    await importEnrichment.createDocRecurse(file);
    const imported = await Device.findOne({ hostname: 'IMPP-RCJ1-DUB-11' });
    expect(imported).toMatchObject({ model: 'ex4300', vendor: 'Juniper', type: 'Switch' });

    const pop = await app.models.POP.create({ name: 'P', shortName: 'P' });
    const sector = await app.models.Sector.create({ name: 'S' });
    const cty = await app.models.County.create({ name: 'G', acronym: 'G' });
    await agent
      .post('/devices')
      .type('form')
      .send({
        'device[hostname]': 'NEWP-RCJ1-DUB-12',
        'device[ipaddress]': '10.30.0.12',
        'device[model]': 'C300',
        'device[type]': '',
        'device[vendor]': '',
        'device[popName][name]': String(pop._id),
        'device[sector][name]': String(sector._id),
        'device[county][name]': String(cty._id),
      })
      .expect(302);
    expect(await Device.findOne({ hostname: 'NEWP-RCJ1-DUB-12' })).toMatchObject({
      model: 'C300',
      vendor: 'ZTE',
      type: 'MSAN',
    });
  });
});
