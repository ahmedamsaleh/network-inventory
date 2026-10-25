/**
 * CRUD for /cabinets and the cabinet -> POP resolution on devices.
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

describe('Cabinet CRUD (authenticated)', () => {
  let cabinetId;

  test('all routes are guarded', async () => {
    const fake = new app.mongoose.Types.ObjectId();
    for (const url of [
      '/cabinets',
      '/cabinets/pagination',
      '/cabinets/new',
      '/cabinets/' + fake,
      '/cabinets/' + fake + '/edit',
    ]) {
      await app.anon().get(url).expect(302).expect('location', '/login');
    }
    await app
      .anon()
      .post('/cabinets')
      .type('form')
      .send({})
      .expect(302)
      .expect('location', '/login');
    await app
      .anon()
      .put('/cabinets/' + fake)
      .type('form')
      .send({})
      .expect(302)
      .expect('location', '/login');
    await app
      .anon()
      .delete('/cabinets/' + fake)
      .expect(302)
      .expect('location', '/login');
  });

  test('INDEX and NEW render', async () => {
    const index = await agent.get('/cabinets').expect(200);
    expect(index.text).toContain('data-url="/cabinets/pagination"');
    expect(index.text).toContain('href="/cabinets"'); // header link
    const form = await agent.get('/cabinets/new').expect(200);
    for (const field of ['cabinet', 'pop', 'location', 'locNotes'])
      expect(form.text).toContain(`name="cabinet[${field}]"`);
  });

  test('CREATE stores trimmed fields with defaults and the author', async () => {
    await agent
      .post('/cabinets')
      .type('form')
      .send({
        'cabinet[cabinet]': ' ONGAR ',
        'cabinet[pop]': '',
        'cabinet[location]': ' 53.2412,-6.4367 ',
        'cabinet[locNotes]': 'Behind the station',
      })
      .expect(302)
      .expect('location', '/cabinets');
    const cabinet = await app.models.Cabinet.findOne({ cabinet: 'ONGAR' });
    expect(cabinet).toMatchObject({
      cabinet: 'ONGAR',
      pop: 'Unknown',
      location: '53.2412,-6.4367',
      locNotes: 'Behind the station',
    });
    expect(cabinet.author.email).toBe('admin@example.com');
    expect(cabinet.createdAt).toBeInstanceOf(Date);
    cabinetId = String(cabinet._id);
  });

  test('CREATE rejects a missing or duplicate cabinet name', async () => {
    await agent
      .post('/cabinets')
      .type('form')
      .send({ 'cabinet[pop]': 'X' })
      .expect(302)
      .expect('location', '/cabinets/new');
    await agent
      .post('/cabinets')
      .type('form')
      .send({ 'cabinet[cabinet]': 'ONGAR' })
      .expect(302)
      .expect('location', '/cabinets/new');
    expect(await app.models.Cabinet.countDocuments({ cabinet: 'ONGAR' })).toBe(1);
  });

  test('SHOW / EDIT / 404', async () => {
    const show = await agent.get('/cabinets/' + cabinetId).expect(200);
    expect(show.text).toContain('Behind the station');
    const edit = await agent.get('/cabinets/' + cabinetId + '/edit').expect(200);
    expect(edit.text).toContain('value="53.2412,-6.4367"');
    await agent.get('/cabinets/' + new app.mongoose.Types.ObjectId()).expect(404);
    await agent.get('/cabinets/not-an-id/edit').expect(404);
  });

  test('UPDATE and PAGINATION', async () => {
    await agent
      .put('/cabinets/' + cabinetId)
      .type('form')
      .send({ 'cabinet[pop]': ' ONGAR ', 'cabinet[locNotes]': '' })
      .expect(302)
      .expect('location', '/cabinets/' + cabinetId);
    const updated = await app.models.Cabinet.findById(cabinetId);
    expect(updated).toMatchObject({ pop: 'ONGAR', locNotes: '', location: '53.2412,-6.4367' });
    expect(updated.lastUpdate).toBeInstanceOf(Date);
    const page = await agent.get('/cabinets/pagination').query({ search: 'ongar' }).expect(200);
    expect(page.body.total).toBe(1);
    expect(page.body.rows[0]).toMatchObject({
      _id: cabinetId,
      cabinet: 'ONGAR',
      pop: 'ONGAR',
      createdBy: 'admin@example.com',
    });
  });

  test('DESTROY', async () => {
    await agent
      .delete('/cabinets/' + cabinetId)
      .expect(302)
      .expect('location', '/cabinets');
    expect(await app.models.Cabinet.findById(cabinetId)).toBeNull();
    await agent.delete('/cabinets/not-an-id').expect(302).expect('location', '/cabinets'); // reported, no crash
  });
});

describe('device POP resolved from the cabinet', () => {
  let pop;
  let sector;
  let cty;

  beforeAll(async () => {
    const { POP, Sector, County, Cabinet } = app.models;
    pop = await POP.create({
      name: 'Wicklow POP',
      shortName: 'WIK',
      cty: 'WIK',
      district: 'Wicklow town',
      sector: 'East',
      popType: 'Edge',
      popLongName: 'Wicklow main POP',
    });
    await POP.create({ name: 'Dublin POP', shortName: 'DUB', cty: 'D' });
    sector = await Sector.create({ name: 'Some sector' });
    cty = await County.create({ name: 'Some county', acronym: 'SG' });
    await Cabinet.create({ cabinet: 'ONGAR', pop: 'WIK', location: 'x' });
    await Cabinet.create({ cabinet: 'NOPOP', pop: 'Unknown' });
    await Cabinet.create({ cabinet: 'GHOST', pop: 'NOSUCHPOP' });
  });

  function form(overrides) {
    return Object.assign(
      {
        'device[hostname]': 'ONGAR-R39J-D-IR',
        'device[ipaddress]': '10.20.0.1',
        'device[type]': 'Router',
        'device[model]': 'MX',
        'device[vendor]': 'Juniper',
        'device[popName][name]': String(pop._id),
        'device[sector][name]': String(sector._id),
        'device[county][name]': String(cty._id),
      },
      overrides
    );
  }

  test('CREATE with a known cabinet takes the POP (and its data) from the cabinet', async () => {
    await agent
      .post('/devices')
      .type('form')
      .send(form({ 'device[cabinet]': ' ongar ' }))
      .expect(302);
    const device = await app.models.Device.findOne({ hostname: 'ONGAR-R39J-D-IR' });
    expect(device).toMatchObject({
      cabinet: 'ongar',
      pop: 'WIK',
      popLongName: 'Wicklow main POP',
      cty: 'WIK',
      district: 'Wicklow town',
      popType: 'Edge',
    });
    expect(device.sector.name).toBe('East');
    expect(device.popName.name).toBe('Wicklow POP');
  });

  test('CREATE with a cabinet whose POP is Unknown or not a real POP keeps/sets only what is known', async () => {
    await agent
      .post('/devices')
      .type('form')
      .send(
        form({
          'device[hostname]': 'NOPOP-R01J-D-IR',
          'device[ipaddress]': '10.20.0.2',
          'device[cabinet]': 'NOPOP',
          'device[pop]': 'DUB',
        })
      )
      .expect(302);
    const noPop = await app.models.Device.findOne({ hostname: 'NOPOP-R01J-D-IR' });
    expect(noPop.pop).toBe('DUB'); // untouched
    await agent
      .post('/devices')
      .type('form')
      .send(
        form({
          'device[hostname]': 'GHOST-R01J-D-IR',
          'device[ipaddress]': '10.20.0.3',
          'device[cabinet]': 'GHOST',
        })
      )
      .expect(302);
    const ghost = await app.models.Device.findOne({ hostname: 'GHOST-R01J-D-IR' });
    expect(ghost.pop).toBe('NOSUCHPOP'); // the cabinet's POP name, no POP data to copy
    expect(ghost.popLongName).toBe('Unkown');
  });

  test('UPDATE that sets the cabinet resolves the POP too', async () => {
    const device = await app.models.Device.findOne({ hostname: 'NOPOP-R01J-D-IR' });
    await agent
      .put('/devices/' + device._id)
      .type('form')
      .send({
        'device[hostname]': device.hostname,
        'device[ipaddress]': device.ipaddress,
        'device[cabinet]': 'ONGAR',
        'device[popName][name]': String(pop._id),
        'device[county][name]': String(cty._id),
        'device[sector][name]': 'Some sector',
      })
      .expect(302);
    const updated = await app.models.Device.findById(device._id);
    expect(updated).toMatchObject({
      cabinet: 'ONGAR',
      pop: 'WIK',
      popLongName: 'Wicklow main POP',
      cty: 'WIK',
      popType: 'Edge',
    });
    expect(updated.sector.name).toBe('East');
    expect(updated.popName.name).toBe('Wicklow POP');
  });

  test('sync uses the cabinet before the hostname prefix', async () => {
    const { syncDevices } = require('../services/syncRunner');
    const { OIDS } = require('../services/syncDevice');
    const device = await app.models.Device.create({
      hostname: 'DUB-R01J-D-IR',
      ipaddress: '10.20.0.9',
      cabinet: 'ONGAR',
      community: 'c',
      type: 'Router',
    });
    const sys = {
      [OIDS.sysDescr]: 'x',
      [OIDS.sysObjectID]: '1.3.6.1.4.1.2636.1',
      [OIDS.sysName]: 'DUB-R01J-D-IR',
    };
    const createSession = () => ({
      isNull: false,
      error: null,
      async get(oids) {
        return Object.fromEntries(oids.map((oid) => [oid, sys[oid]]));
      },
      async tableColumns() {
        return {};
      },
      close() {},
    });
    const run = await syncDevices([device], { createSession });
    expect(run.results[0]).toMatchObject({ ok: true, pop: 'WIK' });
    const synced = await app.models.Device.findById(device._id);
    expect(synced).toMatchObject({ pop: 'WIK', popLongName: 'Wicklow main POP', cty: 'WIK' }); // cabinet ONGAR -> WIK, not DUB
  });
});
