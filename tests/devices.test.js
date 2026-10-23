/**
 * CRUD for /devices.
 *
 * Current-behavior notes (asserted below):
 *  - Creating a device kicks off a background SNMP discovery against the
 *    device IP. In tests that discovery simply times out in the background
 *    (logged by winston) and the device stays `discovered: false`.
 *  - The POST handler expects the pop/sector/governorate *ids* inside the
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
let gov;

beforeAll(async () => {
  app = await bootApp();
  ({ agent, user } = await authedAgent(app));
  pop = await app.models.POP.create({ name: 'POP-1', shortName: 'P1' });
  sector = await app.models.Sector.create({ name: 'Sector-1' });
  gov = await app.models.Governorate.create({ name: 'Giza', acronym: 'GZ' });
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
      'device[governorate][name]': String(gov._id),
    },
    overrides || {}
  );
}

describe('Device CRUD (authenticated)', () => {
  let deviceId;

  test('NEW: GET /devices/new renders the form', async () => {
    const res = await agent.get('/devices/new').expect(200);
    expect(res.text).toContain('name="device[hostname]"');
  });

  test('CREATE: POST /devices resolves pop/sector/governorate ids to names and stores the author', async () => {
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
    expect(device.governorate.name).toBe('Giza');
    expect(device.author.email).toBe(user.email);
    expect(device.discovered).toBe(false); // SNMP discovery cannot succeed here
    expect(device.interfaces).toHaveLength(0);
  });

  test('INDEX: GET /devices renders the list', async () => {
    const res = await agent.get('/devices').expect(200);
    expect(res.text).toContain('router-001');
    expect(res.text).toContain('10.1.2.3');
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

  test('CREATE: omitting type/model/vendor crashes the handler -> 500, nothing stored', async () => {
    // `type.trim()` & co. run on undefined. With the callback-based Mongoose 4
    // code this TypeError escaped into a process-level uncaughtException and
    // the request hung forever; with async handlers Express 5 turns the
    // rejection into a 500 response. Nothing is stored either way.
    const form = deviceForm({ 'device[hostname]': 'router-004', 'device[ipaddress]': '10.4.4.4' });
    delete form['device[type]'];
    delete form['device[model]'];
    delete form['device[vendor]'];

    await agent.post('/devices').type('form').send(form).expect(500);
    expect(await app.models.Device.countDocuments({})).toBe(1); // nothing was stored
  });

  test('SHOW: GET /devices/:id renders the device', async () => {
    const res = await agent.get('/devices/' + deviceId).expect(200);
    expect(res.text).toContain('router-001');
  });

  test('SHOW: non-existent (but valid) id responds 500', async () => {
    await agent.get('/devices/' + new app.mongoose.Types.ObjectId()).expect(500);
  });

  test('EDIT: GET /devices/:id/edit renders the form', async () => {
    const res = await agent.get('/devices/' + deviceId + '/edit').expect(200);
    expect(res.text).toContain('router-001');
  });

  test('UPDATE: PUT /devices/:id updates the device (ids in the [name] fields, select2 workaround)', async () => {
    // NOTE: the handler still calls updatedDevice.save() on the pre-update
    // document after findByIdAndUpdate. That save always rejects ("Duplicate
    // hostname"/"Duplicate IP": mongoose validates every path on save and the
    // uniqueness validators do not exclude the document itself). Previously
    // the rejection was silently dropped; now it is awaited, logged and
    // ignored before the redirect - the findByIdAndUpdate already persisted.
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
        'device[governorate][id]': String(gov._id),
        'device[governorate][name]': String(gov._id),
      })
      .expect(302)
      .expect('location', '/devices/' + deviceId);

    const device = await app.models.Device.findById(deviceId);
    expect(device.description).toBe('updated description');
    expect(device.model).toBe('MX960');
    expect(device.popName.name).toBe('POP-1'); // id was resolved back to the name
    expect(device.governorate.name).toBe('Giza');
    expect(device.lastUpdatedBy.email).toBe(user.email);
    expect(device.updatedAt).toBeDefined();
  });

  test('UPDATE: PUT /devices/:id responds 500 when popName.name is not a valid ObjectId', async () => {
    // The handler unconditionally does mongoose.Types.ObjectId(popName.name),
    // so submitting an actual pop *name* (what a plain form would contain)
    // throws synchronously -> 500.
    await agent
      .put('/devices/' + deviceId)
      .type('form')
      .send({
        'device[hostname]': 'router-001',
        'device[ipaddress]': '10.1.2.3',
        'device[popName][name]': 'POP-1',
        'device[governorate][name]': 'Giza',
      })
      .expect(500);
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
