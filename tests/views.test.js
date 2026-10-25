/**
 * The reworked views: dashboard, device page with the related records,
 * interface show / edit with every catalog field, consistent server-side
 * pagination on every list, form validation (client attributes + server
 * rejection) and the shared layout (navigation, flashes).
 */
const { bootApp, adminAgent, operatorAgent } = require('./helpers/boot');

let app;
let admin;
let operator;
let models;
let pop;
let sector;
let cty;
let device;
let intf;

async function seed() {
  const { POP, Sector, County, Cabinet, DeviceModel, BTMSANInfo, Device, Interface, Link } = models;
  pop = await POP.create({
    name: 'Dublin main POP',
    shortName: 'DUBP',
    cty: 'DUB',
    district: 'Downtown',
    sector: 'North',
    popType: 'Core',
    popLongName: 'Dublin main point of presence',
  });
  sector = await Sector.create({ name: 'North', description: 'northern region' });
  cty = await County.create({ name: 'Dublin', acronym: 'DUB' });
  await Cabinet.create({ cabinet: 'DUBP', pop: 'DUBP', location: '30.05,31.23' });
  await DeviceModel.create({ name: 'MX480', vendor: 'Juniper', type: 'Router' });
  await BTMSANInfo.create({
    msanCode: 'MSAN-001',
    mngIP: '10.77.0.1',
    sector: 'North',
    district: 'Downtown',
  });
  device = await Device.create({
    hostname: 'DUBP-R01J-DUB-01',
    ipaddress: '10.77.0.1',
    type: 'Router',
    model: 'MX480',
    vendor: 'Juniper',
    popName: { id: pop._id, name: pop.name },
    sector: { id: sector._id, name: sector.name },
    county: { id: cty._id, name: cty.name },
    pop: 'DUBP',
    popLongName: 'Dublin main point of presence',
    popType: 'Core',
    cabinet: 'DUBP',
    cty: 'DUB',
    district: 'Downtown',
    btMSANCode: 'MSAN-001',
    btMngIP: '10.77.0.1',
    btSector: 'North',
    btDistrict: 'Downtown',
    sysName: 'dubp-r01',
    sysObjectID: '1.3.6.1.4.1.2636.1.1.1.2.25',
    discovered: true,
    lastSyncTime: new Date('2024-05-01T10:00:00Z'),
    author: { email: 'seed@example.com' },
  });
  intf = await Interface.create({
    ifName: 'ge-0/0/0',
    ifIndex: 1,
    ifAlias: 'INT-IPT-Cogent-DUB-10GIG-B2-NB-L22-1_300050661-EIG_IPT_10G_0019-EIG',
    ifSpeed: 10000000000,
    adminStatus: 'up',
    operStatus: 'up',
    device: { id: device._id, hostname: device.hostname, ipaddress: device.ipaddress },
  });
  await Link.create({
    device1: 'DUBP-R01J-DUB-01',
    interface1: 'ge-0/0/0',
    device2: 'CORP-R01J-COR-01',
    interface2: 'ge-0/0/1',
    type: 'WAN',
    speed: 10000000000,
  });
}

beforeAll(async () => {
  app = await bootApp();
  models = app.models;
  admin = await adminAgent(app);
  ({ agent: operator } = await operatorAgent(app));
  await seed();
});

afterAll(async () => {
  await app.close();
});

describe('layout', () => {
  test('every page shares the navigation with the current section highlighted', async () => {
    const res = await admin.get('/pops').expect(200);
    expect(res.text).toContain('class="navbar navbar-default navbar-static-top app-navbar"');
    for (const href of [
      '/devices',
      '/interfaces',
      '/links',
      '/pops',
      '/cabinets',
      '/devices/decommissioned',
      '/devicemodels',
      '/btmsaninfos',
      '/sectors',
      '/counties',
      '/enrichments/import',
      '/enrichments/export',
      '/users',
      '/validatedusers',
      '/audit',
    ]) {
      expect(res.text).toContain('href="' + href + '"');
    }
    expect(res.text).toMatch(/<li class="active"><a href="\/pops">/);
    expect(res.text).toContain('Administrator <span class="label label-primary">admin</span>');
  });

  test('warning flashes are shown (they used to be set but never rendered)', async () => {
    await admin.get('/devices/sync').expect(302); // starts a run
    await admin.get('/devices/sync').expect(302); // "already in progress" warning
    const res = await admin.get('/devices').expect(200);
    expect(res.text).toMatch(/alert-(warning|success)/);
    expect(res.text).toContain('alert-dismissible');
  });

  test('anonymous visitors get login / sign up links and no data', async () => {
    const res = await app.anon().get('/login').expect(200);
    expect(res.text).toContain('href="/signup"');
    expect(res.text).toContain('type="email"');
    expect(res.text).toContain('required');
  });
});

describe('dashboard', () => {
  test('GET /home shows the inventory counts, sync status and recent activity', async () => {
    const res = await admin.get('/home').expect(200);
    expect(res.text).toContain('Active devices');
    expect(res.text).toContain('Decommissioned devices');
    expect(res.text).toContain('Known slow (short SNMP timeout)');
    expect(res.text).toContain('Recently synchronised');
    expect(res.text).toContain('DUBP-R01J-DUB-01');
    expect(res.text).toContain('Active devices by');
    expect(res.text).toContain('filter[vendor]=Juniper');
    expect(res.text).toContain('Recent activity');
    expect(res.text).toContain('href="/devices/sync"');
    const dashboard = require('../services/dashboard');
    const summary = await dashboard.summary();
    expect(summary.totals).toMatchObject({
      devices: 1,
      decommissioned: 0,
      discovered: 1,
      interfaces: 1,
      links: 1,
      pops: 1,
      cabinets: 1,
      devicemodels: 1,
      btmsaninfos: 1,
    });
    expect(summary.byVendor).toEqual([{ value: 'Juniper', count: 1 }]);
    expect(summary.recentlySynced[0]).toMatchObject({
      hostname: 'DUBP-R01J-DUB-01',
      snmpProfile: 'default',
    });
  });

  test('the dashboard counts decommissioned devices separately', async () => {
    const { Device } = models;
    const extra = await Device.create({
      hostname: 'GONE-R01J-DUB-01',
      ipaddress: '10.77.0.2',
      decommissioned: true,
      decommissionedAt: new Date(),
    });
    const summary = await require('../services/dashboard').summary();
    expect(summary.totals.devices).toBe(1);
    expect(summary.totals.decommissioned).toBe(1);
    await Device.deleteOne({ _id: extra._id });
  });
});

describe('device page', () => {
  test('shows every field, grouped, with links to the related POP / cabinet / model / BT MSAN entry', async () => {
    const res = await admin.get('/devices/' + device._id).expect(200);
    // identity / location / BT / SNMP groups
    for (const text of [
      'Dublin main point of presence', // POP long name
      'Core', // POP type
      'Downtown', // district
      'MSAN-001', // BT MSAN code
      '10.77.0.1', // BT management IP
      'dubp-r01', // sysName
      '1.3.6.1.4.1.2636.1.1.1.2.25',
      'SNMP profile',
      'Last sync error',
      'Default collector',
    ]) {
      expect(res.text).toContain(text);
    }
    const cabinet = await models.Cabinet.findOne({ cabinet: 'DUBP' });
    const model = await models.DeviceModel.findOne({ name: 'MX480' });
    const bt = await models.BTMSANInfo.findOne({ msanCode: 'MSAN-001' });
    expect(res.text).toContain('href="/pops/' + pop._id + '"');
    expect(res.text).toContain('href="/cabinets/' + cabinet._id + '"');
    expect(res.text).toContain('href="/devicemodels/' + model._id + '"');
    expect(res.text).toContain('href="/btmsaninfos/' + bt._id + '"');
    expect(res.text).toContain('1 link(s)');
    // the interface table is the shared server-side table filtered on the hostname
    expect(res.text).toContain(
      'data-url="/interfaces/pagination?filter[hostname]=DUBP-R01J-DUB-01"'
    );
    expect(res.text).toContain('data-field="sp_provider"');
    expect(res.text).toContain('href="/interfaces/new?device=' + device._id + '"');
    expect(res.text).toContain('href="/devices/' + device._id + '/decommission"');
  });

  test('a device without related records shows the fallbacks', async () => {
    const lonely = await models.Device.create({
      hostname: 'LONE-R01J-DUB-01',
      ipaddress: '10.77.0.9',
      model: 'Unknown-model',
      cabinet: 'NOCAB',
    });
    const res = await admin.get('/devices/' + lonely._id).expect(200);
    expect(res.text).toContain('no BT MSAN info matches this device');
    expect(res.text).toContain('NOCAB');
    await models.Device.deleteOne({ _id: lonely._id });
  });

  test('/devices/hostname/:hostname goes to the device page, 404 when unknown', async () => {
    await admin
      .get('/devices/hostname/DUBP-R01J-DUB-01')
      .expect(302)
      .expect('location', '/devices/' + device._id);
    await admin.get('/devices/hostname/NOPE-R01J-DUB-01').expect(404);
  });

  test('the edit form carries the validation attributes and the current values', async () => {
    const res = await admin.get('/devices/' + device._id + '/edit').expect(200);
    expect(res.text).toContain('name="device[hostname]" value="DUBP-R01J-DUB-01" readonly');
    expect(res.text).toContain('name="device[btMngIP]" value="10.77.0.1" pattern=');
    expect(res.text).toContain('name="device[snmpSlow]"');
    expect(res.text).toContain('<option value="' + pop._id + '" selected>Dublin main POP</option>');
    expect(res.text).toContain('<option value="' + sector._id + '" selected>North</option>');
    expect(res.text).toContain('<option value="Router" selected>');
  });

  test('the new form requires hostname / IP and offers the device types', async () => {
    const res = await admin.get('/devices/new').expect(200);
    expect(res.text).toMatch(/name="device\[hostname\]"[^>]*required/);
    expect(res.text).toMatch(/name="device\[hostname\]"[^>]*minlength="5"/);
    expect(res.text).toMatch(/name="device\[ipaddress\]"[^>]*pattern="/);
    expect(res.text).toContain('<option value="MSAN">MSAN</option>');
  });
});

describe('form validation (server side)', () => {
  test('device: invalid BT management IP is rejected on create and update', async () => {
    const before = await models.Device.countDocuments({});
    await admin
      .post('/devices')
      .type('form')
      .send({
        'device[hostname]': 'BADIP-R01J-DUB-01',
        'device[ipaddress]': '10.77.0.3',
        'device[btMngIP]': 'not-an-ip',
        'device[popName][name]': String(pop._id),
        'device[sector][name]': String(sector._id),
        'device[county][name]': String(cty._id),
      })
      .expect(302)
      .expect('location', '/devices/new');
    expect(await models.Device.countDocuments({})).toBe(before);
    const form = await admin.get('/devices/new').expect(200);
    expect(form.text).toContain('BT management IP must be a valid IPv4 address');

    await admin
      .put('/devices/' + device._id)
      .type('form')
      .send({
        'device[btMngIP]': '999.1.1.1',
        'device[popName][name]': String(pop._id),
        'device[county][name]': String(cty._id),
      })
      .expect(302)
      .expect('location', '/devices/' + device._id + '/edit');
    expect((await models.Device.findById(device._id)).btMngIP).toBe('10.77.0.1');
  });

  test('device: a hostname with spaces or without a POP goes back to the form', async () => {
    const before = await models.Device.countDocuments({});
    await admin
      .post('/devices')
      .type('form')
      .send({
        'device[hostname]': 'has space-R01',
        'device[ipaddress]': '10.77.0.4',
        'device[popName][name]': String(pop._id),
        'device[sector][name]': String(sector._id),
        'device[county][name]': String(cty._id),
      })
      .expect(302)
      .expect('location', '/devices/new');
    await admin
      .post('/devices')
      .type('form')
      .send({
        'device[hostname]': 'NOPOP-R01J-DUB-01',
        'device[ipaddress]': '10.77.0.4',
        'device[popName][name]': 'NONE',
        'device[sector][name]': String(sector._id),
        'device[county][name]': String(cty._id),
      })
      .expect(302)
      .expect('location', '/devices/new');
    expect(await models.Device.countDocuments({})).toBe(before);
    expect((await admin.get('/devices/new').expect(200)).text).toContain(
      'Please choose the POP from the list'
    );
  });

  test('device update: the sector picker value (id) is resolved to {id, name}', async () => {
    await admin
      .put('/devices/' + device._id)
      .type('form')
      .send({
        'device[sector][name]': String(sector._id),
        'device[popName][name]': String(pop._id),
        'device[county][name]': String(cty._id),
        'device[description]': 'edited',
      })
      .expect(302)
      .expect('location', '/devices/' + device._id);
    const stored = await models.Device.findById(device._id);
    expect(stored.sector.name).toBe('North');
    expect(String(stored.sector.id)).toBe(String(sector._id));
    expect(stored.description).toBe('edited');
  });

  test('POP: name and short name are required; the message comes back to the form', async () => {
    const before = await models.POP.countDocuments({});
    await admin
      .post('/pops')
      .type('form')
      .send({ 'pop[name]': 'No short name' })
      .expect(302)
      .expect('location', '/pops/new');
    expect(await models.POP.countDocuments({})).toBe(before);
    expect((await admin.get('/pops/new').expect(200)).text).toContain('POP short name is required');
    // on update a blank short name means "unchanged" (the form marks it required anyway)
    await admin
      .put('/pops/' + pop._id)
      .type('form')
      .send({ 'pop[shortName]': '', 'pop[popLongName]': 'Dublin main point of presence' })
      .expect(302)
      .expect('location', '/pops/' + pop._id);
    expect((await models.POP.findById(pop._id)).shortName).toBe('DUBP');
  });

  test('county: acronym must be 1-6 letters/digits (stored upper-case)', async () => {
    await admin
      .post('/counties')
      .type('form')
      .send({ 'county[name]': 'Cork', 'county[acronym]': 'too-long!' })
      .expect(302)
      .expect('location', '/counties/new');
    expect(await models.County.findOne({ name: 'Cork' })).toBeNull();
    await admin
      .post('/counties')
      .type('form')
      .send({ 'county[name]': 'Cork', 'county[acronym]': 'wik' })
      .expect(302)
      .expect('location', '/counties');
    expect((await models.County.findOne({ name: 'Cork' })).acronym).toBe('WIK');
  });

  test('sector: the description is stored; a blank name is refused on update', async () => {
    await admin
      .put('/sectors/' + sector._id)
      .type('form')
      .send({ 'sector[name]': '', 'sector[description]': 'x' })
      .expect(302)
      .expect('location', '/sectors/' + sector._id + '/edit');
    expect((await models.Sector.findById(sector._id)).name).toBe('North');
  });

  test('link: both devices are required, the type is an enum and the speed a number', async () => {
    const before = await models.Link.countDocuments({});
    await admin
      .post('/links')
      .type('form')
      .send({ 'link[device1]': 'ONLY-R01J-DUB-01' })
      .expect(302)
      .expect('location', '/links/new');
    await admin
      .post('/links')
      .type('form')
      .send({
        'link[device1]': 'A-R01J-DUB-01',
        'link[device2]': 'B-R01J-DUB-01',
        'link[speed]': 'fast',
      })
      .expect(302)
      .expect('location', '/links/new');
    await admin
      .post('/links')
      .type('form')
      .send({
        'link[device1]': 'A-R01J-DUB-01',
        'link[device2]': 'B-R01J-DUB-01',
        'link[type]': 'Weird',
      })
      .expect(302)
      .expect('location', '/links/new');
    expect(await models.Link.countDocuments({})).toBe(before);
    expect((await admin.get('/links/new').expect(200)).text).toContain('Type must be Local or WAN');
    await admin
      .post('/links')
      .type('form')
      .send({
        'link[device1]': 'A-R01J-DUB-01',
        'link[device2]': 'B-R01J-DUB-01',
        'link[type]': 'Local',
        'link[speed]': '1000000000',
        'link[label]': ' labelled ',
      })
      .expect(302)
      .expect('location', '/links');
    const link = await models.Link.findOne({ device1: 'A-R01J-DUB-01' });
    expect(link).toMatchObject({ type: 'Local', speed: 1000000000, label: 'labelled' });
  });

  test('validated user: e-mail format, role enum and duplicates are checked', async () => {
    await admin
      .post('/validatedusers')
      .type('form')
      .send({ 'user[name]': 'X', 'user[email]': 'not-an-email', 'user[role]': 'operator' })
      .expect(302)
      .expect('location', '/validatedusers/new');
    await admin
      .post('/validatedusers')
      .type('form')
      .send({ 'user[name]': 'X', 'user[email]': 'x@example.com', 'user[role]': 'root' })
      .expect(302)
      .expect('location', '/validatedusers/new');
    expect(await models.ValidatedUser.findOne({ email: 'x@example.com' })).toBeNull();
    await admin
      .post('/validatedusers')
      .type('form')
      .send({ 'user[name]': 'X', 'user[email]': 'X@Example.com', 'user[role]': 'operator' })
      .expect(302)
      .expect('location', '/validatedusers');
    expect(await models.ValidatedUser.findOne({ email: 'x@example.com' })).toMatchObject({
      role: 'operator',
    });
    await admin
      .post('/validatedusers')
      .type('form')
      .send({ 'user[name]': 'X', 'user[email]': 'x@example.com', 'user[role]': 'operator' })
      .expect(302)
      .expect('location', '/validatedusers/new');
    expect((await admin.get('/validatedusers/new').expect(200)).text).toContain(
      'already on the list'
    );
  });

  test('BT MSAN info: the management IP must be IPv4', async () => {
    await admin
      .post('/btmsaninfos')
      .type('form')
      .send({ 'btmsaninfo[msanCode]': 'MSAN-BAD', 'btmsaninfo[mngIP]': '10.0.0' })
      .expect(302)
      .expect('location', '/btmsaninfos/new');
    expect(await models.BTMSANInfo.findOne({ msanCode: 'MSAN-BAD' })).toBeNull();
  });

  test('signup: name, valid e-mail and a 6+ character password are required (form re-rendered with the messages)', async () => {
    const res = await app
      .anon()
      .post('/signup')
      .type('form')
      .send({ name: '', email: 'nope', password: 'abc' })
      .expect(200);
    expect(res.text).toContain('Name is required');
    expect(res.text).toContain('A valid e-mail address is required');
    expect(res.text).toContain('at least 6 characters');
    expect(res.text).toContain('value="nope"'); // the form keeps what was typed
    expect(await models.User.findOne({ email: 'nope' })).toBeNull();
  });

  test('login failure shows the reason', async () => {
    const client = app.agent();
    await client
      .post('/login')
      .type('form')
      .send({ email: 'admin@example.com', password: 'wrong' })
      .expect(302)
      .expect('location', '/login');
    expect((await client.get('/login').expect(200)).text).toContain('Incorrect password');
  });

  test('e-mail verification with an unknown token is reported, not celebrated', async () => {
    const res = await app.anon().get('/verify').query({ authToken: 'nope' }).expect(404);
    expect(res.text).toContain('Unknown verification link');
  });
});

describe('interfaces', () => {
  test('the show page lists every catalog field, grouped, with the device link', async () => {
    const res = await admin.get('/interfaces/' + intf._id).expect(200);
    for (const field of models.Interface.fieldCatalog) {
      expect(res.text).toContain('<th>' + field.label.replace(/&/g, '&amp;') + '</th>');
    }
    expect(res.text).toContain('href="/devices/' + device._id + '"');
    expect(res.text).toContain('10 Gbit/s');
    expect(res.text).toContain('Cogent'); // parsed provider
    expect(res.text).toContain('href="/interfaces/' + intf._id + '/edit"');
  });

  test('the edit form renders every editable field with typed inputs and rejects bad numbers / dates', async () => {
    const res = await admin.get('/interfaces/' + intf._id + '/edit').expect(200);
    expect(res.text).toMatch(/name="interface\[ifIndex\]"[^>]*required/);
    expect(res.text).toMatch(/id="interface-ifSpeed"[^>]*type="number"/);
    expect(res.text).toContain('id="interface-hostname"'); // read only, from the device
    expect(res.text).not.toContain('name="interface[hostname]"');
    expect(res.text).toContain('class="panel panel-default app-international"');

    await admin
      .put('/interfaces/' + intf._id)
      .type('form')
      .send({ 'interface[ifIndex]': 'one', 'interface[lastSyncTime]': 'yesterday' })
      .expect(302)
      .expect('location', '/interfaces/' + intf._id + '/edit');
    const form = await admin.get('/interfaces/' + intf._id + '/edit').expect(200);
    expect(form.text).toContain('ifIndex: must be a number');
    expect(form.text).toContain('Last sync: must be a date');
    expect((await models.Interface.findById(intf._id)).ifIndex).toBe(1);

    await admin
      .put('/interfaces/' + intf._id)
      .type('form')
      .send({ 'interface[ifName]': '' })
      .expect(302)
      .expect('location', '/interfaces/' + intf._id + '/edit');
    expect((await models.Interface.findById(intf._id)).ifName).toBe('ge-0/0/0');
  });

  test('a new interface needs ifName and an integer ifIndex', async () => {
    const before = await models.Interface.countDocuments({});
    await admin
      .post('/interfaces')
      .type('form')
      .send({
        'interface[ifName]': '',
        'interface[ifIndex]': '2',
        'interface[device][id]': String(device._id),
      })
      .expect(302)
      .expect('location', '/interfaces/new?device=' + device._id);
    await admin
      .post('/interfaces')
      .type('form')
      .send({
        'interface[ifName]': 'ge-0/0/2',
        'interface[ifIndex]': '2.5',
        'interface[device][id]': String(device._id),
      })
      .expect(302)
      .expect('location', '/interfaces/new?device=' + device._id);
    expect(await models.Interface.countDocuments({})).toBe(before);
    expect((await admin.get('/interfaces/new?device=' + device._id).expect(200)).text).toContain(
      'ifIndex: must be a non-negative integer'
    );
  });

  test('the interface list exposes every catalog field as a column', async () => {
    const res = await admin.get('/interfaces').expect(200);
    for (const field of models.Interface.fieldCatalog) {
      expect(res.text).toContain('data-field="' + field.name + '"');
    }
    expect(res.text).toContain('data-formatter="hostnameLinkFormatter"');
  });
});

describe('consistent pagination', () => {
  test.each([
    ['/devices', 'hostname', 'DUBP-R01J-DUB-01'],
    ['/interfaces', 'ifName', 'ge-0/0/0'],
    ['/links', 'device1', 'DUBP-R01J-DUB-01'],
    ['/pops', 'name', 'Dublin main POP'],
    ['/cabinets', 'cabinet', 'DUBP'],
    ['/devicemodels', 'name', 'MX480'],
    ['/btmsaninfos', 'msanCode', 'MSAN-001'],
    ['/sectors', 'name', 'North'],
    ['/counties', 'name', 'Dublin'],
    ['/users', 'email', 'admin@example.com'],
    ['/validatedusers', 'email', 'admin@example.com'],
    ['/audit', 'action', null],
    ['/enrichments', 'SE_Name', null],
    ['/devices/decommissioned', 'hostname', null],
  ])(
    '%s renders the shared table and %s/pagination answers {total, rows}',
    async (base, field, sample) => {
      const page = await admin.get(base).expect(200);
      expect(page.text).toContain('data-url="' + base + '/pagination');
      expect(page.text).toContain('data-side-pagination="server"');
      expect(page.text).toContain('data-query-params-type="limit"');
      expect(page.text).toContain('data-page-list="[10, 25, 50, 100, 500]"');
      expect(page.text).toContain('data-field="' + field + '"');
      const json = await admin
        .get(base + '/pagination')
        .query({ limit: 5 })
        .expect(200);
      expect(typeof json.body.total).toBe('number');
      expect(Array.isArray(json.body.rows)).toBe(true);
      if (sample) {
        const filtered = await admin
          .get(base + '/pagination')
          .query({ search: sample, limit: 5 })
          .expect(200);
        expect(filtered.body.rows.map((row) => row[field])).toContain(sample);
      }
    }
  );

  test('the page query string pre-filters the table (dashboard links)', async () => {
    const res = await admin.get('/devices?filter[vendor]=Juniper&search=DUBP').expect(200);
    expect(res.text).toContain(
      'data-url="/devices/pagination?filter[vendor]=Juniper&amp;search=DUBP"'
    );
    expect(res.text).toContain('data-search-text="DUBP"');
    // [empty]=0 / [empty]=1 split the active devices into "with" / "without" a sync error
    const { Device } = models;
    const failed = await Device.countDocuments(
      Device.activeFilter({ lastSyncError: { $nin: [null, ''] } })
    );
    const active = await Device.countDocuments(Device.activeFilter());
    const json = await admin
      .get('/devices/pagination')
      .query({ 'filter[lastSyncError][empty]': '0' })
      .expect(200);
    expect(json.body.total).toBe(failed);
    const none = await admin
      .get('/devices/pagination')
      .query({ 'filter[lastSyncError][empty]': '1' })
      .expect(200);
    expect(none.body.total).toBe(active - failed);
    await Device.updateOne({ _id: device._id }, { $set: { lastSyncError: 'boom' } });
    const withError = await admin
      .get('/devices/pagination')
      .query({ 'filter[lastSyncError][empty]': '0', search: 'DUBP-R01J' })
      .expect(200);
    expect(withError.body.rows.map((row) => row.hostname)).toEqual(['DUBP-R01J-DUB-01']);
    await Device.updateOne({ _id: device._id }, { $set: { lastSyncError: '' } });
  });

  test('users / validated users are paginated but not exported', async () => {
    await admin.get('/enrichments/api/users').expect(404);
    const exportPage = await admin.get('/enrichments/export').expect(200);
    expect(exportPage.text).not.toContain('value="users"');
    expect(exportPage.text).toContain('value="enrichments"');
  });

  test('POP list and page show the POP long name', async () => {
    const page = await admin.get('/pops').expect(200);
    expect(page.text).toContain('data-field="popLongName"');
    expect(page.text).toMatch(/data-field="popLongName"[^>]*data-visible="true"/);
    const show = await admin.get('/pops/' + pop._id).expect(200);
    expect(show.text).toContain('Dublin main point of presence');
    expect(show.text).toContain('1 active device(s)');
    expect(show.text).toContain('DUBP'); // cabinet link
  });
});

describe('operators', () => {
  test('an operator sees the pages but not the admin-only actions', async () => {
    const res = await operator.get('/users').expect(200);
    expect(res.text).toContain('label-default">operator</span>');
    const user = await models.User.findOne({ email: 'admin@example.com' });
    await operator.get('/users/' + user._id + '/edit').expect(302);
    const show = await operator.get('/users/' + user._id).expect(200);
    expect(show.text).not.toContain('href="/users/' + user._id + '/edit"');
  });

  test('an admin edits name and role of an account (role is validated)', async () => {
    const user = await models.User.findOne({ email: 'operator@example.com' });
    await admin
      .put('/users/' + user._id)
      .type('form')
      .send({ 'user[name]': 'Op', 'user[role]': 'superuser' })
      .expect(302)
      .expect('location', '/users/' + user._id + '/edit');
    expect((await models.User.findById(user._id)).role).toBe('operator');
    await admin
      .put('/users/' + user._id)
      .type('form')
      .send({ 'user[name]': 'Op Renamed', 'user[role]': 'operator' })
      .expect(302)
      .expect('location', '/users/' + user._id);
    expect((await models.User.findById(user._id)).name).toBe('Op Renamed');
  });
});
