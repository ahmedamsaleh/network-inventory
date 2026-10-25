/**
 * CRUD for /interfaces.
 *
 * The router is mounted at /interfaces (not under a device), so the owning
 * device is passed explicitly: GET /interfaces/new?device=<id> and the form's
 * hidden interface[device][id] on POST.
 *
 *  - GET /interfaces/:id renders a show page with every catalog field
 *    (guarded); PUT redirects to it.
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

describe('Interface model extension', () => {
  test('defaults: sp_* "Unknown", speeds "Unknown", flags, isUpLink "0", Local/WAN type empty', async () => {
    const intf = await app.models.Interface.create({ ifName: 'ge-7/7/7', ifIndex: 77 });
    expect(intf.sp_service).toBe('Unknown');
    expect(intf.sp_customer).toBe('Unknown');
    expect(intf.sp_speed).toBe(0);
    expect(intf.speedCat).toBe('Unknown');
    expect(intf.ifSpeedText).toBe('Unknown');
    expect(intf.actualspeedText).toBe('Unknown');
    expect(intf.type).toBe('');
    expect(intf.specialService).toBe('');
    expect(intf.isUpLink).toBe('0');
    expect(intf.apiFlag).toBe(false);
    expect(intf.noEnrichmentFlag).toBe(false);
    expect(intf.unknownFlag).toBe(0);
    expect(intf.counters).toEqual({});
    expect(intf.createdAt).toBeInstanceOf(Date);
    expect(app.models.Interface.fieldCatalog.map((f) => f.name)).toEqual(
      expect.arrayContaining([
        'ifName',
        'ifAlias',
        'ifIndex',
        'ifDescr',
        'ifType',
        'ifTypeStr',
        'ifSpeed',
        'ifHighSpeed',
        'ifHCInOctets',
        'ifHCOutOctets',
        'pollInterval',
        'counters',
        'type',
        'specialService',
        'secondPOP',
        'secondHost',
        'secondInterface',
        'secondDeviceType',
        'secondPOPType',
        'label',
        'apiFlag',
        'noEnrichmentFlag',
        'devType',
        'devVendor',
        'devModel',
        'sp_service',
        'sp_preNumber',
        'sp_speed',
        'speedCat',
        'unknownFlag',
        'actualspeed',
        'isUpLink',
        'ifSpeedText',
        'ifHighSpeedText',
        'sp_speedText',
        'actualspeedText',
        'devPOP',
        'devPOPLongName',
        'devCabinet',
        'devCty',
        'devDistrict',
        'devSector',
        'devPOPType',
        'btMSANCode',
        'btMngIP',
        'btSector',
        'btDistrict',
        'createdAt',
        'lastUpdate',
        'lastSyncTime',
        'hostname',
        'ipaddress',
        'pop',
      ])
    );
  });

  test('legacy and canonical names are kept in sync both ways; ifTypeStr from ifType', async () => {
    const fromLegacy = await app.models.Interface.create({
      name: 'ge-1/0/0',
      alias: 'legacy alias',
      index: 5,
      description: 'd',
      speed: 1e9,
      ifType: 6,
      device: { hostname: 'h-legacy', ipaddress: '10.0.0.9' },
    });
    expect(fromLegacy).toMatchObject({
      ifName: 'ge-1/0/0',
      ifAlias: 'legacy alias',
      ifIndex: 5,
      ifDescr: 'd',
      ifSpeed: 1e9,
      ifTypeStr: 'ethernet-csmacd',
      hostname: 'h-legacy',
      ipaddress: '10.0.0.9',
    });
    const fromCanonical = await app.models.Interface.create({
      ifName: 'xe-2/0/0',
      ifAlias: 'canonical',
      ifIndex: 6,
      ifDescr: 'dd',
      ifSpeed: 10e9,
    });
    expect(fromCanonical).toMatchObject({
      name: 'xe-2/0/0',
      alias: 'canonical',
      index: 6,
      description: 'dd',
      speed: 10e9,
    });
    fromCanonical.ifAlias = 'renamed';
    await fromCanonical.save();
    expect(fromCanonical.alias).toBe('renamed');
  });

  test('applyParsedAlias fills the sp_* fields, special service, label and speed texts', async () => {
    const intf = new app.models.Interface({
      ifName: 'xe-0/0/0',
      ifAlias: 'INT-IPT-Cogent-DUB-10GIG-B2-NB-L22-1_300050661-EIG_IPT_10G_0019-EIG',
      ifSpeed: 10e9,
      ifHighSpeed: 10000,
    });
    intf.applyParsedAlias();
    expect(intf).toMatchObject({
      specialService: 'International',
      sp_service: 'IPT',
      sp_provider: 'Cogent',
      sp_termination: 'DUB',
      sp_bundleId: 'B2',
      sp_connType: 'NB',
      sp_linkNumber: 'L22',
      sp_CID: '1_300050661',
      sp_BTCID: 'EIG_IPT_10G_0019',
      sp_subCable: 'EIG',
      sp_customer: 'Unknown',
      sp_speed: 10e9,
      sp_speedText: '10 Gbps',
      ifSpeedText: '10 Gbps',
      ifHighSpeedText: '10 Gbps',
      actualspeedText: 'Unknown',
      speedCat: '10G',
      unknownFlag: 0,
      label: 'International Cogent L22 10 Gbps',
    });
    const unknown = new app.models.Interface({ ifAlias: 'INT-too-short' });
    unknown.applyParsedAlias();
    expect(unknown).toMatchObject({
      specialService: 'International',
      unknownFlag: 1,
      sp_service: 'Unknown',
      sp_speed: 0,
    });
  });
});

describe('Interface CRUD (authenticated)', () => {
  test('INDEX: GET /interfaces renders the list', async () => {
    await makeLinkedInterface({ name: 'ge-9/9/9', index: 99, alias: 'index-test' });
    const res = await agent.get('/interfaces').expect(200);
    expect(res.text).toContain('data-url="/interfaces/pagination"');
    const json = await agent.get('/interfaces/pagination').expect(200);
    const row = json.body.rows.find((r) => r.ifName === 'ge-9/9/9');
    expect(row).toBeDefined();
    expect(row.hostname).toBe('router-ifx');
    expect(res.text).toContain('data-field="sp_provider"'); // every catalog field is a column
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
    expect(res.text).toContain('Add an interface');
    expect(res.text).toContain('to router-ifx');
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
    expect(intf.ifName).toBe('ge-0/0/7'); // legacy input names land on the canonical fields
    expect(intf.ifAlias).toBe('created-via-http');
    expect(intf.ifIndex).toBe(7);
    expect(intf.ifSpeed).toBe(1000000000);
    expect(intf.ifSpeedText).toBe('1 Gbps');
    expect(intf.speedCat).toBe('1G');
    expect(intf.author.email).toBe(user.email);
    expect(intf.device.hostname).toBe('router-ifx');
    expect(intf.hostname).toBe('router-ifx'); // device fields copied
    expect(intf.ipaddress).toBe('10.5.5.5');
    expect(intf.devPOPLongName).toBe('Unkown');
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

  test('SHOW: GET /interfaces/:id renders the show page (every catalog field) and is guarded', async () => {
    const intf = await makeLinkedInterface({ name: 'ge-1/1/1', index: 11, alias: 'show-me' });
    const authed = await agent.get('/interfaces/' + intf._id).expect(200);
    expect(authed.text).toContain('show-me');
    expect(authed.text).not.toContain('name="interface[ifAlias]"'); // not the edit form
    for (const field of app.models.Interface.fieldCatalog) {
      expect(authed.text).toContain('<th>' + field.label.replace(/&/g, '&amp;') + '</th>');
    }
    expect(authed.text).toContain('href="/interfaces/' + intf._id + '/edit"');
    await app
      .anon()
      .get('/interfaces/' + intf._id)
      .expect(302)
      .expect('location', '/login');
    await agent.get('/interfaces/' + new app.mongoose.Types.ObjectId()).expect(404);
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
      .expect('location', '/interfaces/' + intf._id);

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

describe('Interface edit form / update with the extended fields', () => {
  test('EDIT form renders every catalog field (inputs, selects, read-only dates)', async () => {
    const intf = await makeLinkedInterface({
      name: 'ge-8/8/8',
      index: 88,
      alias: 'THREE-BITSTREAM L6 1GIG',
    });
    const res = await agent.get('/interfaces/' + intf._id + '/edit').expect(200);
    for (const field of app.models.Interface.fieldCatalog) {
      if (field.readOnly) {
        expect(res.text).toContain('id="interface-' + field.name + '"');
      } else {
        expect(res.text).toContain('name="interface[' + field.name + ']"');
      }
    }
    expect(res.text).toContain('<option value="WAN"');
    expect(res.text).toContain('value="ge-8/8/8"');
  });

  test('UPDATE writes the new fields with coercion and re-parses a changed alias', async () => {
    const intf = await makeLinkedInterface({ name: 'ge-9/0/0', index: 90, alias: 'before' });
    await agent
      .put('/interfaces/' + intf._id)
      .type('form')
      .send({
        'interface[ifName]': ' ge-9/0/0 ',
        'interface[ifAlias]': 'ESP-BT_ACCESS-TEMPLEBAR-INT-1-100',
        'interface[ifType]': '6',
        'interface[ifTypeStr]': 'ethernet-csmacd',
        'interface[ifSpeed]': '1000000000',
        'interface[ifHighSpeed]': '1000',
        'interface[ifHCInOctets]': '123456',
        'interface[ifHCOutOctets]': '654321',
        'interface[pollInterval]': '300',
        'interface[type]': 'WAN',
        'interface[secondInterface]': 'xe-0/0/1',
        'interface[secondDeviceType]': 'Router',
        'interface[secondPOPType]': 'Core',
        'interface[apiFlag]': 'yes',
        'interface[noEnrichmentFlag]': 'no',
        'interface[isUpLink]': '1',
        'interface[actualspeed]': '100000000',
        'interface[devType]': 'Router',
        'interface[devVendor]': 'Juniper',
        'interface[devModel]': 'MX',
        'interface[btMngIP]': '10.200.0.1',
        'interface[lastSyncTime]': '2024-01-31T10:00:00Z',
        'interface[createdAt]': '1999-01-01T00:00:00Z', // read-only: ignored
        'interface[linkType]': 'Normal',
      })
      .expect(302)
      .expect('location', '/interfaces/' + intf._id);

    const updated = await app.models.Interface.findById(intf._id);
    expect(updated).toMatchObject({
      ifName: 'ge-9/0/0',
      name: 'ge-9/0/0',
      ifAlias: 'ESP-BT_ACCESS-TEMPLEBAR-INT-1-100',
      alias: 'ESP-BT_ACCESS-TEMPLEBAR-INT-1-100',
      ifType: 6,
      ifTypeStr: 'ethernet-csmacd',
      ifSpeed: 1e9,
      speed: 1e9,
      ifHighSpeed: 1000,
      ifHCInOctets: 123456,
      ifHCOutOctets: 654321,
      pollInterval: 300,
      type: 'WAN',
      secondInterface: 'xe-0/0/1',
      secondDeviceType: 'Router',
      secondPOPType: 'Core',
      apiFlag: true,
      noEnrichmentFlag: false,
      isUpLink: '1',
      actualspeed: 100e6,
      devType: 'Router',
      devVendor: 'Juniper',
      devModel: 'MX',
      btMngIP: '10.200.0.1',
      // parsed from the new alias
      specialService: 'ESP',
      sp_customer: 'BT_ACCESS',
      sp_pop: 'TEMPLEBAR',
      sp_connType: 'INT',
      sp_emsOrder: '1',
      sp_connectedBW: '100',
      sp_speed: 100e6,
      sp_speedText: '100 Mbps',
      ifSpeedText: '1 Gbps',
      ifHighSpeedText: '1 Gbps',
      actualspeedText: '100 Mbps',
      speedCat: '100M',
      unknownFlag: 0,
    });
    expect(updated.lastSyncTime.toISOString()).toBe('2024-01-31T10:00:00.000Z');
    expect(updated.createdAt.getFullYear()).not.toBe(1999);
    expect(updated.lastUpdate).toBeInstanceOf(Date);
    expect(updated.updated.getTime()).toBe(updated.lastUpdate.getTime());

    // invalid values are ignored, not crashing: bad number, unknown select option, bad date
    await agent
      .put('/interfaces/' + intf._id)
      .type('form')
      .send({
        'interface[ifHighSpeed]': 'lots',
        'interface[type]': 'Martian',
        'interface[lastSyncTime]': 'yesterday',
      })
      .expect(302);
    const again = await app.models.Interface.findById(intf._id);
    expect(again.ifHighSpeed).toBe(1000);
    expect(again.type).toBe('WAN');
    expect(again.lastSyncTime.toISOString()).toBe('2024-01-31T10:00:00.000Z');
  });
});
