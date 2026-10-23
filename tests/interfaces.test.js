/**
 * CRUD for /interfaces.
 *
 * The interfaces router is written as if it were mounted under
 * /devices/:id/interfaces (it reads request.params.id everywhere), but
 * application.js mounts it at /interfaces. Consequences asserted below:
 *
 *  - GET /interfaces/new responds 500: Device.findById(undefined) yields
 *    null and the "new" view dereferences device._id.
 *  - POST /interfaces creates the Interface document (with author) but then
 *    crashes on `foundDevice.interfaces.push` (foundDevice is null) inside a
 *    Mongoose callback, so the HTTP request NEVER gets a response and the
 *    interface is never attached to any device.
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
    expect(res.text).toContain('ge-9/9/9');
    expect(res.text).toContain('router-ifx');
  });

  test('NEW: GET /interfaces/new responds 500 (view needs a device that the route never finds)', async () => {
    await agent.get('/interfaces/new').expect(500);
  });

  test('CREATE: POST /interfaces stores an orphaned interface and responds 500', async () => {
    // The route looks the device up with request.params.id, which is never
    // set at this mount point -> foundDevice is null -> TypeError on
    // `foundDevice.interfaces.push`. Previously (callback code) the TypeError
    // was swallowed process-wide and the request hung; with async handlers
    // Express 5 answers 500. The interface document is created either way.
    await agent
      .post('/interfaces')
      .type('form')
      .send({
        'interface[name]': 'ge-0/0/7',
        'interface[alias]': 'created-via-http',
        'interface[index]': '7',
        'interface[type]': 'ethernet',
        'interface[speed]': '1000000000',
      })
      .expect(500);

    // the interface WAS created and even got its author filled in ...
    const intf = await app.models.Interface.findOne({ name: 'ge-0/0/7' });
    expect(intf).not.toBeNull();
    expect(intf.alias).toBe('created-via-http');
    expect(intf.author.email).toBe(user.email);
    // ... but it is attached to no device
    expect(intf.device.toObject()).toEqual({});
    const dev = await app.models.Device.findById(device._id);
    expect(dev.interfaces.some((i) => i.name === 'ge-0/0/7')).toBe(false);
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
        'interface[termination]': 'ALX',
        'interface[subCable]': 'SMW4',
        'interface[teCID]': 'CID-1',
        'interface[linkID]': 'L10',
      })
      .expect(302);
    const updated = await app.models.Interface.findById(intf._id);
    expect(updated.linkType).toBe('International');
    expect(updated.provider).toBe('SomeProvider');
    expect(updated.service).toBe('IPT');
    expect(updated.termination).toBe('ALX');
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
