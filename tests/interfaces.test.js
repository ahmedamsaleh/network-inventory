/**
 * CRUD for /interfaces.
 *
 * The router is mounted at /interfaces (not under a device), so the owning
 * device is passed explicitly: GET /interfaces/new?device=<id> and the form's
 * hidden interface[device][id] on POST.
 *
 *  - GET /interfaces/:id (the "show" route) renders the *edit* template and
 *    is not protected by isLoggedIn.
 *  - PUT/DELETE also maintain the embedded copy of the interface inside the
 *    owning device (found via the interface's stored device.hostname).
 */
const { bootApp, authedAgent } = require('./helpers/boot');

let app;
let agent;
let user;
let device;

async function makeLinkedInterface(fields) {
  const intf = await app.models.Interface.create(
    Object.assign(
      {
        device: { id: device._id, hostname: device.hostname, ipaddress: device.ipaddress },
        author: { id: user._id, email: user.email },
      },
      fields
    )
  );
  // NB: push via an atomic update; loading the device and calling .save()
  // would fail with "Duplicate hostname"/"Duplicate IP" (see TESTING-NOTES.md)
  await app.models.Device.findByIdAndUpdate(device._id, { $push: { interfaces: intf } });
  return intf;
}

beforeAll(async () => {
  app = await bootApp();
  ({ agent, user } = await authedAgent(app));
  device = await app.models.Device.create({
    hostname: 'router-ifx',
    ipaddress: '10.5.5.5',
    author: { id: user._id, email: user.email },
  });
});

afterAll(async () => {
  await app.close();
});

describe('Interface CRUD (authenticated)', () => {
  test('INDEX: GET /interfaces renders the list', async () => {
    await makeLinkedInterface({ name: 'ge-9/9/9', index: 99, alias: 'index-test' });
    const res = await agent.get('/interfaces').expect(200);
    expect(res.text).toContain('data-url="/interfaces/pagination"');
    const json = await agent.get('/interfaces/pagination').expect(200);
    const row = json.body.rows.find((r) => r.name === 'ge-9/9/9');
    expect(row).toBeDefined();
    expect(row.device).toBe('router-ifx');
  });

  test('NEW: GET /interfaces/new needs a device (?device=<id>)', async () => {
    // without a device there is nothing to attach the interface to
    await agent.get('/interfaces/new').expect(302).expect('location', '/devices');
    await agent
      .get('/interfaces/new')
      .query({ device: new app.mongoose.Types.ObjectId() })
      .expect(404);
    const res = await agent
      .get('/interfaces/new')
      .query({ device: String(device._id) })
      .expect(200);
    expect(res.text).toContain('Add New Interface to router-ifx');
    expect(res.text).toContain('action="/interfaces"');
    expect(res.text).toContain('name="interface[device][id]" value="' + device._id + '"');
  });

  test('CREATE: POST /interfaces creates the interface and attaches it to the device', async () => {
    await agent
      .post('/interfaces')
      .type('form')
      .send({
        'interface[name]': 'ge-0/0/7',
        'interface[alias]': 'created-via-http',
        'interface[index]': '7',
        'interface[type]': 'ethernet',
        'interface[speed]': '1000000000',
        'interface[device][id]': String(device._id),
        'interface[device][hostname]': 'ignored-the-device-is-looked-up',
      })
      .expect(302)
      .expect('location', '/devices/' + device._id);

    const intf = await app.models.Interface.findOne({ name: 'ge-0/0/7' });
    expect(intf).not.toBeNull();
    expect(intf.alias).toBe('created-via-http');
    expect(intf.author.email).toBe(user.email);
    expect(intf.device.hostname).toBe('router-ifx');
    expect(String(intf.device.id)).toBe(String(device._id));
    const dev = await app.models.Device.findById(device._id);
    expect(dev.interfaces.some((i) => i.name === 'ge-0/0/7')).toBe(true);
  });

  test('CREATE: POST /interfaces without a (valid) device creates nothing and redirects', async () => {
    const before = await app.models.Interface.countDocuments({});
    await agent
      .post('/interfaces')
      .type('form')
      .send({ 'interface[name]': 'orphan-0' })
      .expect(302)
      .expect('location', '/devices');
    await agent
      .post('/interfaces')
      .type('form')
      .send({ 'interface[name]': 'orphan-1', 'interface[device][id]': 'not-an-id' })
      .expect(302)
      .expect('location', '/devices');
    await agent
      .post('/interfaces')
      .type('form')
      .send({
        'interface[name]': 'orphan-2',
        'interface[device][id]': String(new app.mongoose.Types.ObjectId()),
      })
      .expect(302)
      .expect('location', '/devices');
    expect(await app.models.Interface.countDocuments({})).toBe(before);
  });

  test('SHOW: GET /interfaces/:id renders the edit template and requires NO login', async () => {
    const intf = await makeLinkedInterface({ name: 'ge-1/1/1', index: 11, alias: 'show-me' });
    const authed = await agent.get('/interfaces/' + intf._id).expect(200);
    expect(authed.text).toContain('show-me');
    // ODD: this route has no isLoggedIn guard
    const anon = await app
      .anon()
      .get('/interfaces/' + intf._id)
      .expect(200);
    expect(anon.text).toContain('show-me');
  });

  test('EDIT: GET /interfaces/:id/edit renders the form (guarded)', async () => {
    const intf = await makeLinkedInterface({ name: 'ge-2/2/2', index: 22, alias: 'edit-me' });
    const res = await agent.get('/interfaces/' + intf._id + '/edit').expect(200);
    expect(res.text).toContain('edit-me');
  });

  test('UPDATE: PUT /interfaces/:id updates the document and the embedded copy on the device', async () => {
    const intf = await makeLinkedInterface({ name: 'ge-3/3/3', index: 33, alias: 'before' });

    await agent
      .put('/interfaces/' + intf._id)
      .type('form')
      .send({
        'interface[name]': 'ge-3/3/3',
        'interface[alias]': 'after',
        'interface[description]': 'updated via http',
        'interface[type]': 'ethernet',
        'interface[actualspeed]': '1000',
        'interface[isDeviceUpLink]': 'yes',
        'interface[isPOPUpLink]': 'no',
        'interface[secondHost]': 'other-host',
        'interface[secondPOP]': 'other-pop',
        'interface[connectionType]': 'fiber',
        'interface[linkBandwidth]': '100',
        'interface[linkIP]': '1.1.1.1',
        'interface[linkNumber]': 'L-1',
        'interface[linkType]': 'Normal',
      })
      .expect(302)
      .expect('location', '/devices/');

    const updated = await app.models.Interface.findById(intf._id);
    expect(updated.alias).toBe('after');
    expect(updated.description).toBe('updated via http');
    expect(updated.isDeviceUpLink).toBe(true); // "yes" -> true
    expect(updated.isPOPUpLink).toBe(false); // "no" -> false
    expect(updated.secondHost).toBe('other-host');
    expect(updated.lastUpdatedBy.email).toBe(user.email);
    expect(updated.updated).toBeInstanceOf(Date);

    const dev = await app.models.Device.findById(device._id);
    const embedded = dev.interfaces.find((i) => i.index === 33);
    expect(embedded.alias).toBe('after'); // embedded copy kept in sync
  });

  test('UPDATE: international-only fields are ignored while linkType is "Normal"', async () => {
    const intf = await makeLinkedInterface({ name: 'ge-4/4/4', index: 44 });
    await agent
      .put('/interfaces/' + intf._id)
      .type('form')
      .send({
        'interface[name]': 'ge-4/4/4',
        'interface[linkType]': 'Normal',
        'interface[provider]': 'SomeProvider',
        'interface[service]': 'IPT',
      })
      .expect(302);
    const updated = await app.models.Interface.findById(intf._id);
    expect(updated.provider).toBeUndefined();
    expect(updated.service).toBeUndefined();
  });

  test('UPDATE: international fields are stored when linkType is "International"', async () => {
    const intf = await makeLinkedInterface({ name: 'ge-5/5/5', index: 55 });
    await agent
      .put('/interfaces/' + intf._id)
      .type('form')
      .send({
        'interface[name]': 'ge-5/5/5',
        'interface[linkType]': 'International',
        'interface[provider]': 'SomeProvider',
        'interface[service]': 'IPT',
        'interface[termination]': 'COR',
        'interface[subCable]': 'SMW4',
        'interface[teCID]': 'CID-1',
        'interface[linkID]': 'L10',
      })
      .expect(302);
    const updated = await app.models.Interface.findById(intf._id);
    expect(updated.linkType).toBe('International');
    expect(updated.provider).toBe('SomeProvider');
    expect(updated.service).toBe('IPT');
    expect(updated.termination).toBe('COR');
  });

  test('DESTROY: DELETE /interfaces/:id removes the document and the embedded copy', async () => {
    const intf = await makeLinkedInterface({ name: 'ge-6/6/6', index: 66 });

    await agent
      .delete('/interfaces/' + intf._id)
      .set('Referer', app.baseUrl + '/devices/' + device._id)
      .expect(302)
      .expect('location', app.baseUrl + '/devices/' + device._id); // redirect "back"
    expect(await app.models.Interface.findById(intf._id)).toBeNull();
    const dev = await app.models.Device.findById(device._id);
    expect(dev.interfaces.some((i) => i.index === 66)).toBe(false);
  });
});
