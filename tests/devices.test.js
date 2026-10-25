/**
 * CRUD for /devices.
 *
 * Current-behavior notes (asserted below):
 *  - Creating a device kicks off a background SNMP discovery against the
 *    device IP. In tests that discovery simply times out in the background
 *    (logged by winston) and the device stays `discovered: false`.
 *  - The POST handler expects the pop/sector/county *ids* inside the
 *    `[name]` form fields (select2 workaround) and resolves them to names.
 *  - Validation failures (duplicate hostname/IP, short hostname, invalid
 *    IP) flash an error but still redirect 302 to /devices.
 *  - POST /devices without type/model/vendor never answers (undefined.trim()
 *    crashes in a Mongoose callback).
 *  - PUT /devices/:id responds with the redirect *before* the update has
 *    been persisted, and crashes with 500 if popName.name is not a valid
 *    ObjectId (select2 quirk again).
 */
const { bootApp, authedAgent } = require('./helpers/boot');

let app;
let agent;
let user;
let pop;
let sector;
let cty;

beforeAll(async () => {
  app = await bootApp();
  ({ agent, user } = await authedAgent(app));
  pop = await app.models.POP.create({ name: 'POP-1', shortName: 'P1' });
  sector = await app.models.Sector.create({ name: 'Sector-1' });
  cty = await app.models.County.create({ name: 'Galway', acronym: 'GAL' });
});

afterAll(async () => {
  await app.close();
});

function deviceForm(overrides) {
  return Object.assign(
    {
      'device[hostname]': 'router-001',
      'device[ipaddress]': '10.1.2.3',
      'device[communityString]': 'public',
      'device[type]': 'router',
      'device[model]': 'MX480',
      'device[vendor]': 'juniper',
      'device[popName][name]': String(pop._id),
      'device[sector][name]': String(sector._id),
      'device[county][name]': String(cty._id),
    },
    overrides || {}
  );
}

describe('Device CRUD (authenticated)', () => {
  let deviceId;

  test('NEW: GET /devices/new renders the form', async () => {
    const res = await agent.get('/devices/new').expect(200);
    expect(res.text).toContain('name="device[hostname]"');
    for (const field of [
      'community',
      'pop',
      'popLongName',
      'cabinet',
      'cty',
      'district',
      'popType',
      'btMSANCode',
      'btMngIP',
      'btSector',
      'btDistrict',
    ]) {
      expect(res.text).toContain(`name="device[${field}]"`);
    }
  });

  test('CREATE: POST /devices resolves pop/sector/county ids to names and stores the author', async () => {
    await agent
      .post('/devices')
      .type('form')
      .send(deviceForm())
      .expect(302)
      .expect('location', '/devices');

    const device = await app.models.Device.findOne({ hostname: 'router-001' });
    expect(device).not.toBeNull();
    deviceId = String(device._id);
    expect(device.ipaddress).toBe('10.1.2.3');
    expect(device.communityString).toBe('public');
    expect(device.type).toBe('router');
    expect(device.model).toBe('MX480');
    expect(device.vendor).toBe('juniper');
    expect(device.popName.name).toBe('POP-1');
    expect(device.sector.name).toBe('Sector-1');
    expect(device.county.name).toBe('Galway');
    expect(device.author.email).toBe(user.email);
    expect(device.discovered).toBe(false); // SNMP discovery cannot succeed here
    expect(device.interfaces).toHaveLength(0);
  });

  test('INDEX: GET /devices renders the list', async () => {
    // the list itself is loaded by bootstrap-table from /devices/pagination
    const res = await agent.get('/devices').expect(200);
    expect(res.text).toContain('data-url="/devices/pagination"');
    expect(res.text).toContain('data-side-pagination="server"');
    expect(res.text).toContain('data-field="pop"');
    expect(res.text).toContain('data-field="lastSyncTime"');
    const json = await agent.get('/devices/pagination').expect(200);
    expect(json.body.rows.map((r) => r.hostname)).toContain('router-001');
  });

  test('CREATE: duplicate hostname is rejected (flash + 302, nothing stored)', async () => {
    await agent
      .post('/devices')
      .type('form')
      .send(deviceForm({ 'device[ipaddress]': '10.1.2.99' }))
      .expect(302)
      .expect('location', '/devices');
    expect(await app.models.Device.countDocuments({})).toBe(1);
  });

  test('CREATE: duplicate IP address is rejected (flash + 302, nothing stored)', async () => {
    await agent
      .post('/devices')
      .type('form')
      .send(deviceForm({ 'device[hostname]': 'router-002' }))
      .expect(302)
      .expect('location', '/devices');
    expect(await app.models.Device.countDocuments({})).toBe(1);
  });

  test('CREATE: hostname shorter than 5 chars is rejected', async () => {
    await agent
      .post('/devices')
      .type('form')
      .send(deviceForm({ 'device[hostname]': 'abc', 'device[ipaddress]': '10.9.9.9' }))
      .expect(302)
      .expect('location', '/devices');
    expect(await app.models.Device.countDocuments({})).toBe(1);
  });

  test('CREATE: invalid IPv4 address is rejected', async () => {
    await agent
      .post('/devices')
      .type('form')
      .send(deviceForm({ 'device[hostname]': 'router-003', 'device[ipaddress]': 'not-an-ip' }))
      .expect(302)
      .expect('location', '/devices');
    expect(await app.models.Device.countDocuments({})).toBe(1);
  });

  test('CREATE: omitting type/model/vendor is fine (fields stay unset, defaults apply)', async () => {
    // `type.trim()` & co. used to crash on undefined; optional text fields are
    // now normalized by the route (trimmed, empty -> schema default or unset).
    const form = deviceForm({ 'device[hostname]': 'router-004', 'device[ipaddress]': '10.4.4.4' });
    delete form['device[type]'];
    delete form['device[model]'];
    delete form['device[vendor]'];

    await agent.post('/devices').type('form').send(form).expect(302).expect('location', '/devices');
    const device = await app.models.Device.findOne({ hostname: 'router-004' });
    expect(device).not.toBeNull();
    expect(device.type).toBeUndefined();
    expect(device.model).toBeUndefined();
    expect(device.community).toBe('public');
    expect(device.popLongName).toBe('Unkown');
    await app.models.Device.deleteOne({ _id: device._id });
  });

  test('CREATE: stores the extended site/BT fields trimmed, with defaults for the empty ones', async () => {
    await agent
      .post('/devices')
      .type('form')
      .send(
        deviceForm({
          'device[hostname]': '  router-005  ',
          'device[ipaddress]': ' 10.5.5.5 ',
          'device[community]': '  secretCommunity ',
          'device[communityString]': '', // legacy input name, ignored when `community` is set
          'device[pop]': ' DUB-POP ',
          'device[popLongName]': ' Dublin main POP ',
          'device[cabinet]': '   ', // blank -> default
          'device[cty]': ' Dublin ',
          'device[district]': '',
          'device[popType]': ' Core ',
          'device[btMSANCode]': ' MSAN-001 ',
          'device[btMngIP]': ' 10.200.0.1 ',
          'device[btSector]': ' East ',
          'device[btDistrict]': ' Nasr City ',
        })
      )
      .expect(302);

    const device = await app.models.Device.findOne({ hostname: 'router-005' });
    expect(device).not.toBeNull();
    expect(device.ipaddress).toBe('10.5.5.5');
    expect(device.community).toBe('secretCommunity');
    expect(device.communityString).toBe('secretCommunity'); // legacy field kept in sync
    expect(device.pop).toBe('DUB-POP');
    expect(device.popLongName).toBe('Dublin main POP');
    expect(device.cabinet).toBe('Unkown');
    expect(device.cty).toBe('Dublin');
    expect(device.district).toBe('Unkown');
    expect(device.popType).toBe('Core');
    expect(device.btMSANCode).toBe('MSAN-001');
    expect(device.btMngIP).toBe('10.200.0.1');
    expect(device.btSector).toBe('East');
    expect(device.btDistrict).toBe('Nasr City');
    expect(device.deviceSyncCycles).toBe(0);
    expect(device.lastSyncTime).toBeUndefined();
    expect(device.sysName).toBeUndefined();
    expect(device.interfaces).toEqual([]);
    await app.models.Device.deleteOne({ _id: device._id });
  });

  test('schema has a unique index on hostname and an index on ipaddress', async () => {
    const Device = app.models.Device;
    await Device.init(); // wait for index builds
    const indexes = await Device.collection.indexes();
    const hostnameIndex = indexes.find(
      (i) => i.key.hostname === 1 && Object.keys(i.key).length === 1
    );
    const ipIndex = indexes.find((i) => i.key.ipaddress === 1 && Object.keys(i.key).length === 1);
    expect(hostnameIndex).toBeDefined();
    expect(hostnameIndex.unique).toBe(true);
    expect(ipIndex).toBeDefined();
    expect(ipIndex.unique).toBeFalsy();
  });

  test('SHOW: GET /devices/:id renders the device', async () => {
    const res = await agent.get('/devices/' + deviceId).expect(200);
    expect(res.text).toContain('router-001');
    expect(res.text).toContain('BT MSAN code');
    expect(res.text).toContain('Unkown');
  });

  test('SHOW/EDIT: non-existent or malformed ids respond 404 (not-found page)', async () => {
    const missing = new app.mongoose.Types.ObjectId();
    const res = await agent.get('/devices/' + missing).expect(404);
    expect(res.text).toContain('Device ');
    expect(res.text).toContain(String(missing) + '&#34; does not exist');
    await agent.get('/devices/' + missing + '/edit').expect(404);
    await agent.get('/devices/not-an-object-id').expect(404);
  });

  test('EDIT: GET /devices/:id/edit renders the form', async () => {
    const res = await agent.get('/devices/' + deviceId + '/edit').expect(200);
    expect(res.text).toContain('router-001');
    expect(res.text).toContain('name="device[community]"');
    expect(res.text).toContain('name="device[btDistrict]"');
    expect(res.text).toContain('value="Unkown"'); // defaults pre-filled
  });

  test('UPDATE: PUT /devices/:id updates the device (ids in the [name] fields, select2 workaround)', async () => {
    await agent
      .put('/devices/' + deviceId)
      .type('form')
      .send({
        'device[hostname]': 'router-001',
        'device[ipaddress]': '10.1.2.3',
        'device[description]': 'updated description',
        'device[type]': 'router',
        'device[model]': 'MX960',
        'device[vendor]': 'juniper',
        'device[popName][id]': String(pop._id),
        'device[popName][name]': String(pop._id),
        'device[sector][id]': String(sector._id),
        'device[sector][name]': 'Sector-1',
        'device[county][id]': String(cty._id),
        'device[county][name]': String(cty._id),
        'device[community]': ' private ',
        'device[pop]': ' GAL-POP ',
        'device[cabinet]': ' C-12 ',
        'device[popType]': '', // blank -> default again
        'device[btMngIP]': ' 10.200.0.9 ',
      })
      .expect(302)
      .expect('location', '/devices/' + deviceId);

    const device = await app.models.Device.findById(deviceId);
    expect(device.description).toBe('updated description');
    expect(device.community).toBe('private');
    expect(device.communityString).toBe('private');
    expect(device.pop).toBe('GAL-POP');
    expect(device.cabinet).toBe('C-12');
    expect(device.popType).toBe('Unkown');
    expect(device.btMngIP).toBe('10.200.0.9');
    expect(device.model).toBe('MX960');
    expect(device.popName.name).toBe('POP-1'); // id was resolved back to the name
    expect(device.county.name).toBe('Galway');
    expect(device.lastUpdatedBy.email).toBe(user.email);
    expect(device.updatedAt).toBeDefined();
  });

  test('UPDATE: PUT /devices/:id with a non-ObjectId popName/county goes back to the edit form', async () => {
    // The select2 workaround expects *ids* inside the [name] fields; a plain
    // form submission with actual names is rejected with a flash message.
    await agent
      .put('/devices/' + deviceId)
      .type('form')
      .send({
        'device[hostname]': 'router-001',
        'device[ipaddress]': '10.1.2.3',
        'device[popName][name]': 'POP-1',
        'device[county][name]': 'Galway',
      })
      .expect(302)
      .expect('location', '/devices/' + deviceId + '/edit');
    expect((await app.models.Device.findById(deviceId)).model).toBe('MX960'); // unchanged
  });

  test('DESTROY: DELETE /devices/:id removes the device and its interface documents', async () => {
    // attach a standalone Interface doc + embed it on the device
    const intf = await app.models.Interface.create({
      name: 'ge-0/0/0',
      index: 1,
      device: { id: deviceId, hostname: 'router-001', ipaddress: '10.1.2.3' },
    });
    // NB: push via an atomic update; loading the device and calling .save()
    // would fail with "Duplicate hostname"/"Duplicate IP" (see TESTING-NOTES.md)
    await app.models.Device.findByIdAndUpdate(deviceId, { $push: { interfaces: intf } });

    await agent
      .delete('/devices/' + deviceId)
      .expect(302)
      .expect('location', '/devices');

    expect(await app.models.Device.findById(deviceId)).toBeNull();
    expect(await app.models.Interface.findById(intf._id)).toBeNull();
  });
});
