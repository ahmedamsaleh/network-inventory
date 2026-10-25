/**
 * Device decommissioning (soft delete), its undo, the audit trail and the
 * short SNMP profile for devices known to be slow.
 *
 *   - GET  /devices/:id/decommission   confirmation page (any logged-in user)
 *   - POST /devices/:id/decommission   confirm=yes [+ reason] -> soft delete
 *   - GET/POST /devices/:id/restore    admin only, confirmation step
 *   - DELETE /devices/:id              admin only, permanent, audit first
 *   - GET /devices/decommissioned      list (+ /pagination)
 *   - GET /audit, /audit/pagination, /audit/:id
 */
const { bootApp, adminAgent, operatorAgent } = require('./helpers/boot');

let app;
let admin;
let operator;
let operatorUser;
let Device;
let Interface;
let ArchivedInterface;
let AuditLog;
let Link;
let syncRunner;
let snmpProfile;
let config;

function timeoutError() {
  const error = new Error('Request timed out');
  error.name = 'RequestTimedOutError';
  return error;
}

/** fake SNMP session factory: records the session options, fails or answers */
function sessionFactory(behaviour, created) {
  return (options) => {
    created.push({ host: options.host, timeoutMs: options.timeoutMs, retries: options.retries });
    const fail = behaviour[options.host];
    return {
      isNull: false,
      error: null,
      async get(oids) {
        if (fail) throw fail;
        return Object.fromEntries(oids.map((oid) => [oid, Buffer.from('x')]));
      },
      async tableColumns() {
        if (fail) throw fail;
        return {};
      },
      close() {},
    };
  };
}

async function createDevice(hostname, ipaddress, extra) {
  const device = await Device.create(
    Object.assign(
      {
        hostname,
        ipaddress,
        type: 'router',
        model: 'MX480',
        vendor: 'juniper',
        popName: { name: 'POP-1' },
        sector: { name: 'Sector-1' },
        county: { name: 'Galway' },
        author: { email: 'seed@example.com' },
      },
      extra || {}
    )
  );
  const interfaces = [];
  for (const index of [1, 2]) {
    const intf = await Interface.create({
      ifName: 'ge-0/0/' + index,
      ifIndex: index,
      ifAlias: 'INT-TEST-' + index,
      device: { id: device._id, hostname, ipaddress },
    });
    interfaces.push(intf);
  }
  await Device.updateOne({ _id: device._id }, { $set: { interfaces: interfaces } });
  return { device, interfaces };
}

beforeAll(async () => {
  app = await bootApp();
  ({ Device, Interface, ArchivedInterface, AuditLog, Link } = app.models);
  admin = await adminAgent(app);
  ({ agent: operator, user: operatorUser } = await operatorAgent(app));
  syncRunner = require('../services/syncRunner');
  snmpProfile = require('../services/snmpProfile');
  config = require('../config');
});

afterAll(async () => {
  await app.close();
});

describe('roles', () => {
  test('a user whitelisted as operator signs up with the operator role', async () => {
    expect(operatorUser.role).toBe('operator');
    const adminUser = await app.models.User.findOne({ email: 'admin@example.com' });
    expect(adminUser.role).toBe('admin');
  });
});

describe('guards', () => {
  let id;
  beforeAll(async () => {
    ({
      device: { _id: id },
    } = await createDevice('GUARD-R01J-DUB-01', '10.50.0.1'));
  });

  test.each([
    ['get', '/devices/decommissioned'],
    ['get', '/devices/decommissioned/pagination'],
    ['get', '/audit'],
    ['get', '/audit/pagination'],
  ])('anonymous %s %s is sent to /login', async (method, url) => {
    await app.anon()[method](url).expect(302).expect('location', '/login');
  });

  test('anonymous users cannot decommission, restore or delete', async () => {
    await app.anon().get(`/devices/${id}/decommission`).expect(302).expect('location', '/login');
    await app
      .anon()
      .post(`/devices/${id}/decommission`)
      .type('form')
      .send({ confirm: 'yes' })
      .expect(302)
      .expect('location', '/login');
    await app.anon().get(`/devices/${id}/restore`).expect(302).expect('location', '/login');
    await app
      .anon()
      .post(`/devices/${id}/restore`)
      .type('form')
      .send({ confirm: 'yes' })
      .expect(302)
      .expect('location', '/login');
    await app.anon().delete(`/devices/${id}`).expect(302).expect('location', '/login');
    expect(await Device.findById(id)).toMatchObject({ decommissioned: false });
    expect(await AuditLog.countDocuments({ 'target.id': String(id) })).toBe(0);
  });

  test('the list buttons without a selected row just go back with a message', async () => {
    await operator.get('/devices/-1/decommission').expect(302).expect('location', '/devices');
    await admin
      .get('/devices/-1/restore')
      .expect(302)
      .expect('location', '/devices/decommissioned');
    await admin.delete('/devices/-1').expect(302).expect('location', '/devices');
  });

  test('operators cannot delete a device permanently', async () => {
    await operator.delete(`/devices/${id}`).expect(302);
    expect(await Device.findById(id)).not.toBeNull();
    expect(await AuditLog.countDocuments({ action: 'device.delete' })).toBe(0);
  });
});

describe('decommission -> restore -> permanent delete', () => {
  let device;
  let interfaces;

  beforeAll(async () => {
    ({ device, interfaces } = await createDevice('DECO-R01J-DUB-01', '10.50.1.1'));
    await Link.create({
      device1: 'DECO-R01J-DUB-01',
      interface1: 'ge-0/0/1',
      device2: 'OTHER-R01J-DUB-01',
      interface2: 'ge-0/0/5',
    });
  });

  test('the confirmation page shows what will happen', async () => {
    const res = await operator.get(`/devices/${device._id}/decommission`).expect(200);
    expect(res.text).toContain('Decommission DECO-R01J-DUB-01');
    expect(res.text).toContain('<strong>2</strong> interface record(s)');
    expect(res.text).toContain('1 link(s) still reference');
    expect(res.text).toContain('name="confirm" value="yes"');
    expect(res.text).toContain('name="reason"');
  });

  test('POST without the confirmation does nothing', async () => {
    await operator
      .post(`/devices/${device._id}/decommission`)
      .type('form')
      .send({ reason: 'oops' })
      .expect(302)
      .expect('location', `/devices/${device._id}/decommission`);
    expect(await Device.findById(device._id)).toMatchObject({ decommissioned: false });
    expect(await Interface.countDocuments({ hostname: 'DECO-R01J-DUB-01' })).toBe(2);
    expect(await AuditLog.countDocuments({ 'target.id': String(device._id) })).toBe(0);
  });

  test('POST with confirm=yes marks the device, archives its interfaces and writes the audit entry', async () => {
    await operator
      .post(`/devices/${device._id}/decommission`)
      .type('form')
      .send({ confirm: 'yes', reason: 'site closed' })
      .expect(302)
      .expect('location', '/devices');

    const stored = await Device.findById(device._id);
    expect(stored.decommissioned).toBe(true);
    expect(stored.decommissionedAt).toBeInstanceOf(Date);
    expect(stored.decommissionedBy.email).toBe('operator@example.com');
    expect(String(stored.decommissionedBy.id)).toBe(String(operatorUser._id));
    expect(stored.decommissionReason).toBe('site closed');
    // the embedded snapshot stays on the device
    expect(stored.interfaces).toHaveLength(2);

    // live interface documents are gone, the archive has them under the same ids
    expect(await Interface.countDocuments({ hostname: 'DECO-R01J-DUB-01' })).toBe(0);
    const archived = await ArchivedInterface.find({ 'archive.deviceId': device._id }).sort({
      ifIndex: 1,
    });
    expect(archived.map((intf) => String(intf._id))).toEqual(
      interfaces.map((intf) => String(intf._id))
    );
    expect(archived[0].archive.hostname).toBe('DECO-R01J-DUB-01');
    expect(archived[0].archive.by.email).toBe('operator@example.com');
    expect(archived[0].ifAlias).toBe('INT-TEST-1');

    const entry = await AuditLog.findOne({ action: 'device.decommission' });
    expect(entry).not.toBeNull();
    expect(entry.user.email).toBe('operator@example.com');
    expect(entry.target).toMatchObject({
      type: 'device',
      id: String(device._id),
      label: 'DECO-R01J-DUB-01',
    });
    expect(entry.details.reason).toBe('site closed');
    expect(entry.details.interfacesArchived).toBe(2);
    expect(entry.details.interfaceIds.sort()).toEqual(
      interfaces.map((intf) => String(intf._id)).sort()
    );
    expect(String(archived[0].archive.auditId)).toBe(String(entry._id));
  });

  test('the device disappears from the active lists and shows up in the decommissioned list', async () => {
    const active = await operator.get('/devices/pagination').query({ limit: 100 }).expect(200);
    expect(active.body.rows.map((row) => row.hostname)).not.toContain('DECO-R01J-DUB-01');
    expect(active.body.rows.map((row) => row.hostname)).toContain('GUARD-R01J-DUB-01');

    const gone = await operator
      .get('/devices/decommissioned/pagination')
      .query({ limit: 100 })
      .expect(200);
    expect(gone.body.total).toBe(1);
    expect(gone.body.rows[0]).toMatchObject({
      hostname: 'DECO-R01J-DUB-01',
      decommissionedBy: 'operator@example.com',
      decommissionReason: 'site closed',
    });
    expect(gone.body.rows[0].decommissionedAt).toBeTruthy();

    // exports / API share the dataset filter
    const api = await app
      .anon()
      .get('/enrichments/api/devices')
      .set('x-api-key', 'test-api-key')
      .expect(200);
    expect(api.body.rows.map((row) => row.hostname)).not.toContain('DECO-R01J-DUB-01');
    const filtered = await operator
      .get('/devices/pagination')
      .query({ 'filter[hostname]': 'DECO-R01J-DUB-01' })
      .expect(200);
    expect(filtered.body.total).toBe(0);

    const page = await operator.get('/devices/decommissioned').expect(200);
    expect(page.text).toContain('/devices/decommissioned/pagination');
    expect(page.text).toContain('Only administrators can restore');
  });

  test('the show page carries the banner; sync of a decommissioned device is refused', async () => {
    const res = await operator.get(`/devices/${device._id}`).expect(200);
    expect(res.text).toContain('id="decommissioned-banner"');
    expect(res.text).toContain('site closed');
    expect(res.text).toContain('Ask an administrator to restore it');
    expect(res.text).not.toContain('id="decommission-button"');
    expect(res.text).not.toContain('Delete permanently');

    const asAdmin = await admin.get(`/devices/${device._id}`).expect(200);
    expect(asAdmin.text).toContain('id="restore-button"');
    expect(asAdmin.text).toContain('Delete permanently');

    await operator.get(`/devices/sync/${device._id}`).expect(302).expect('location', '/devices');
    expect(syncRunner.isRunning()).toBe(false);
    const after = await operator.get('/devices').expect(200);
    expect(after.text).toContain('is decommissioned and is not synchronised');
  });

  test('sync runs skip decommissioned devices', async () => {
    const created = [];
    const run = await syncRunner.syncAll({ createSession: sessionFactory({}, created) });
    expect(created.map((c) => c.host)).not.toContain('10.50.1.1');
    expect(run.results.map((r) => r.hostname)).not.toContain('DECO-R01J-DUB-01');
    // and the per-device service refuses one as well
    const { syncDevice } = require('../services/syncDevice');
    const result = await syncDevice(await Device.findById(device._id), {
      createSession: sessionFactory({}, created),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/decommissioned/);
  });

  test('decommissioning twice is refused', async () => {
    await operator
      .get(`/devices/${device._id}/decommission`)
      .expect(302)
      .expect('location', `/devices/${device._id}`);
    await operator
      .post(`/devices/${device._id}/decommission`)
      .type('form')
      .send({ confirm: 'yes' })
      .expect(302)
      .expect('location', `/devices/${device._id}`);
    expect(await AuditLog.countDocuments({ action: 'device.decommission' })).toBe(1);
  });

  test('an operator cannot restore (admin only)', async () => {
    await operator.get(`/devices/${device._id}/restore`).expect(302);
    await operator
      .post(`/devices/${device._id}/restore`)
      .type('form')
      .send({ confirm: 'yes' })
      .expect(302);
    expect(await Device.findById(device._id)).toMatchObject({ decommissioned: true });
    expect(await AuditLog.countDocuments({ action: 'device.restore' })).toBe(0);
    const page = await operator.get('/devices').expect(200);
    expect(page.text).toContain('Administrator rights are required');
  });

  test('an admin restores the device through the confirmation step', async () => {
    const page = await admin.get(`/devices/${device._id}/restore`).expect(200);
    expect(page.text).toContain('Restore DECO-R01J-DUB-01');
    expect(page.text).toContain('<strong>2</strong> archived interface record(s)');

    await admin
      .post(`/devices/${device._id}/restore`)
      .type('form')
      .send({})
      .expect(302)
      .expect('location', `/devices/${device._id}/restore`);
    expect(await Device.findById(device._id)).toMatchObject({ decommissioned: true });

    await admin
      .post(`/devices/${device._id}/restore`)
      .type('form')
      .send({ confirm: 'yes' })
      .expect(302)
      .expect('location', `/devices/${device._id}`);

    const stored = await Device.findById(device._id);
    expect(stored.decommissioned).toBe(false);
    expect(stored.decommissionedAt).toBeUndefined();
    expect(stored.decommissionedBy.email).toBeUndefined();
    expect(stored.decommissionReason).toBeUndefined();
    expect(stored.restoredAt).toBeInstanceOf(Date);

    const live = await Interface.find({ hostname: 'DECO-R01J-DUB-01' }).sort({ ifIndex: 1 });
    expect(live.map((intf) => String(intf._id))).toEqual(
      interfaces.map((intf) => String(intf._id))
    );
    expect(live[1].ifAlias).toBe('INT-TEST-2');
    expect(await ArchivedInterface.countDocuments({ 'archive.deviceId': device._id })).toBe(0);

    const entry = await AuditLog.findOne({ action: 'device.restore' });
    expect(entry.user.email).toBe('admin@example.com');
    expect(entry.target.label).toBe('DECO-R01J-DUB-01');
    expect(entry.details.interfacesRestored).toBe(2);
    expect(entry.details.decommissionedBy).toBe('operator@example.com');

    const active = await admin.get('/devices/pagination').query({ limit: 100 }).expect(200);
    expect(active.body.rows.map((row) => row.hostname)).toContain('DECO-R01J-DUB-01');
    expect((await admin.get('/devices/decommissioned/pagination').expect(200)).body.total).toBe(0);
    await admin
      .get(`/devices/${device._id}/restore`)
      .expect(302)
      .expect('location', `/devices/${device._id}`);
  });

  test('an admin deletes permanently: audit entry with a full snapshot, then everything is removed', async () => {
    // decommission again first so the archive is exercised too
    await admin
      .post(`/devices/${device._id}/decommission`)
      .type('form')
      .send({ confirm: 'yes', reason: 'scrapped' })
      .expect(302);
    expect(await ArchivedInterface.countDocuments({ 'archive.deviceId': device._id })).toBe(2);

    await admin
      .delete(`/devices/${device._id}`)
      .expect(302)
      .expect('location', '/devices/decommissioned');

    expect(await Device.findById(device._id)).toBeNull();
    expect(await Interface.countDocuments({ hostname: 'DECO-R01J-DUB-01' })).toBe(0);
    expect(await ArchivedInterface.countDocuments({ 'archive.deviceId': device._id })).toBe(0);

    const entry = await AuditLog.findOne({ action: 'device.delete' });
    expect(entry.user.email).toBe('admin@example.com');
    expect(entry.target).toMatchObject({ type: 'device', id: String(device._id) });
    expect(entry.details.snapshot.hostname).toBe('DECO-R01J-DUB-01');
    expect(entry.details.snapshot.ipaddress).toBe('10.50.1.1');
    expect(entry.details.decommissioned).toBe(true);
    expect(entry.details.archivedInterfacesDeleted).toBe(2);
    expect(entry.details.archivedInterfaces.map((intf) => intf.ifAlias).sort()).toEqual([
      'INT-TEST-1',
      'INT-TEST-2',
    ]);

    // the whole history of the device is in the log
    const history = await admin
      .get('/audit/pagination')
      .query({ 'filter[targetId]': String(device._id), limit: 50 })
      .expect(200);
    expect(history.body.rows.map((row) => row.action)).toEqual([
      'device.delete',
      'device.decommission',
      'device.restore',
      'device.decommission',
    ]);
    expect(history.body.rows[3].reason).toBe('site closed');
  });
});

describe('every permanent deletion is audited', () => {
  test('DELETE /interfaces/:id writes interface.delete with a snapshot first', async () => {
    const { device, interfaces } = await createDevice('AUDI-R01J-DUB-01', '10.50.2.1');
    await admin.delete(`/interfaces/${interfaces[0]._id}`).expect(302);
    expect(await Interface.findById(interfaces[0]._id)).toBeNull();
    const entry = await AuditLog.findOne({ action: 'interface.delete' });
    expect(entry.target.id).toBe(String(interfaces[0]._id));
    expect(entry.details.snapshot.ifName).toBe('ge-0/0/1');
    expect(entry.details.hostname).toBe('AUDI-R01J-DUB-01');
    expect(entry.user.email).toBe('admin@example.com');
    await Device.deleteOne({ _id: device._id });
  });

  test.each([
    ['pop', 'POP', '/pops', { name: 'Audit POP', shortName: 'AUDP' }],
    ['sector', 'Sector', '/sectors', { name: 'Audit sector' }],
    ['county', 'County', '/counties', { name: 'Audit county', acronym: 'AUG' }],
    ['link', 'Link', '/links', { device1: 'A-R01J-DUB-01', device2: 'B-R01J-DUB-01' }],
    ['cabinet', 'Cabinet', '/cabinets', { cabinet: 'CAB-AUDIT', pop: 'AUDP' }],
    ['devicemodel', 'DeviceModel', '/devicemodels', { name: 'AUDIT-MODEL', vendor: 'x' }],
    ['btmsaninfo', 'BTMSANInfo', '/btmsaninfos', { msanCode: 'AUDIT-MSAN', mngIP: '10.9.9.9' }],
    ['validateduser', 'ValidatedUser', '/validatedusers', { email: 'gone@example.com' }],
  ])('DELETE %s writes %s.delete before removing the document', async (type, model, base, doc) => {
    const created = await app.models[model].create(doc);
    await admin.delete(`${base}/${created._id}`).expect(302);
    expect(await app.models[model].findById(created._id)).toBeNull();
    const entry = await AuditLog.findOne({
      action: type + '.delete',
      'target.id': String(created._id),
    });
    expect(entry).not.toBeNull();
    expect(String(entry.details.snapshot._id)).toBe(String(created._id));
    expect(entry.user.email).toBe('admin@example.com');
  });

  test('an unknown id deletes nothing and logs nothing', async () => {
    const before = await AuditLog.countDocuments({});
    await admin.delete('/pops/' + new app.mongoose.Types.ObjectId()).expect(302);
    await admin.delete('/pops/not-an-id').expect(302);
    expect(await AuditLog.countDocuments({})).toBe(before);
  });

  test('the unguarded DELETE routes record an anonymous actor', async () => {
    const sector = await app.models.Sector.create({ name: 'Anon sector' });
    await app.anon().delete(`/sectors/${sector._id}`).expect(302);
    const entry = await AuditLog.findOne({
      action: 'sector.delete',
      'target.id': String(sector._id),
    });
    expect(entry.user.email).toBe('anonymous');
  });
});

describe('audit log UI', () => {
  test('GET /audit lists entries and GET /audit/:id shows the details', async () => {
    const page = await operator.get('/audit').expect(200);
    expect(page.text).toContain('data-url="/audit/pagination"');

    const list = await operator.get('/audit/pagination').query({ limit: 5 }).expect(200);
    expect(list.body.total).toBeGreaterThan(5);
    expect(list.body.rows).toHaveLength(5);
    // newest first by default
    const times = list.body.rows.map((row) => new Date(row.at).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);

    const entry = await AuditLog.findOne({ action: 'device.delete' });
    const show = await operator.get(`/audit/${entry._id}`).expect(200);
    expect(show.text).toContain('device.delete');
    expect(show.text).toContain('DECO-R01J-DUB-01');
    expect(show.text).toContain('id="audit-details"');
    const json = await operator.get(`/audit/${entry._id}`).set('Accept', 'application/json');
    expect(json.status).toBe(200);
    expect(json.body.details.snapshot.hostname).toBe('DECO-R01J-DUB-01');

    await operator.get('/audit/not-an-id').expect(404);
    const byAction = await operator
      .get('/audit/pagination')
      .query({ 'filter[action]': 'device.restore' })
      .expect(200);
    expect(byAction.body.rows.map((row) => row.action)).toEqual(['device.restore']);
  });
});

describe('imports and decommissioned hostnames', () => {
  test('an import row for a decommissioned hostname is reported, not applied', async () => {
    const { device } = await createDevice('IMPD-R01J-DUB-01', '10.50.3.1');
    await admin
      .post(`/devices/${device._id}/decommission`)
      .type('form')
      .send({ confirm: 'yes' })
      .expect(302);
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const file = path.join(os.tmpdir(), 'decommissioned-import-' + Date.now() + '.csv');
    fs.writeFileSync(
      file,
      'hostname,ipaddress,community\nIMPD-R01J-DUB-01,10.50.3.1,public\nIMPN-R01J-DUB-02,10.50.3.2,public\n'
    );
    const { importDevices } = require('../services/importDevices');
    const report = await importDevices(file, { author: { email: 'admin@example.com' } });
    fs.unlinkSync(file);
    expect(report.errors.map((error) => error.hostname)).toEqual(['IMPD-R01J-DUB-01']);
    expect(report.errors[0].message).toMatch(/decommissioned/);
    expect(await Device.findById(device._id)).toMatchObject({ decommissioned: true });
    expect(await Device.findOne({ hostname: 'IMPN-R01J-DUB-02' })).not.toBeNull();
  });
});

describe('short SNMP profile for devices known to be slow', () => {
  test('sessionOptions: flag wins, timeouts apply unless the vendor has its own options', () => {
    expect(snmpProfile.sessionOptions({ snmpTimeouts: 0 }, {})).toMatchObject({
      profile: 'default',
      options: {},
    });
    expect(snmpProfile.sessionOptions({ snmpSlow: true }, {})).toMatchObject({
      profile: 'slow',
      reason: 'flag',
      options: { timeoutMs: config.snmp.slowTimeoutMs, retries: config.snmp.slowRetries },
    });
    expect(snmpProfile.sessionOptions({ snmpTimeouts: 3 }, {})).toMatchObject({
      profile: 'slow',
      reason: 'timeouts',
    });
    expect(snmpProfile.sessionOptions({ snmpTimeouts: 2 }, {})).toMatchObject({
      profile: 'default',
    });
    // a vendor profile (special Juniper devices) is kept unless the flag is set
    expect(
      snmpProfile.sessionOptions({ snmpTimeouts: 5 }, { timeoutMs: 300000, retries: 10 })
    ).toMatchObject({ profile: 'vendor', options: { timeoutMs: 300000, retries: 10 } });
    expect(
      snmpProfile.sessionOptions({ snmpSlow: true }, { timeoutMs: 300000, retries: 10 })
    ).toMatchObject({ profile: 'slow', options: { timeoutMs: config.snmp.slowTimeoutMs } });
  });

  test('consecutive timeouts switch a device to the short profile; a success switches it back', async () => {
    const { device } = await createDevice('SLOW-R01J-DUB-01', '10.50.4.1');
    const created = [];
    const failing = sessionFactory({ '10.50.4.1': timeoutError() }, created);
    for (let i = 1; i <= 3; i++) {
      const run = await syncRunner.syncDevices([await Device.findById(device._id)], {
        createSession: failing,
      });
      expect(run.results[0].ok).toBe(false);
      expect(await Device.findById(device._id)).toMatchObject({
        snmpTimeouts: i,
        lastSyncError: 'Request timed out',
      });
    }
    // the first three runs used the default profile (no explicit timeout)
    expect(created.slice(0, 3).every((c) => c.timeoutMs === undefined)).toBe(true);
    const page = await admin.get(`/devices/${device._id}`).expect(200);
    expect(page.text).toContain('slow (3 consecutive timeouts)');

    // fourth attempt: short profile
    const fourth = await syncRunner.syncDevices([await Device.findById(device._id)], {
      createSession: failing,
    });
    expect(fourth.results[0].snmpProfile).toBe('slow');
    expect(created[3]).toMatchObject({
      timeoutMs: config.snmp.slowTimeoutMs,
      retries: config.snmp.slowRetries,
    });
    expect(await Device.findById(device._id)).toMatchObject({ snmpTimeouts: 4 });

    // a non-timeout failure does not count as a timeout
    const other = new Error('NoSuchObject');
    await syncRunner.syncDevices([await Device.findById(device._id)], {
      createSession: sessionFactory({ '10.50.4.1': other }, created),
    });
    expect(await Device.findById(device._id)).toMatchObject({
      snmpTimeouts: 4,
      lastSyncError: 'NoSuchObject',
    });

    // success resets the counter -> default profile again
    const ok = await syncRunner.syncDevices([await Device.findById(device._id)], {
      createSession: sessionFactory({}, created),
    });
    expect(ok.results[0].ok).toBe(true);
    expect(await Device.findById(device._id)).toMatchObject({
      snmpTimeouts: 0,
      lastSyncError: '',
    });
    const again = await syncRunner.syncDevices([await Device.findById(device._id)], {
      createSession: sessionFactory({}, created),
    });
    expect(again.results[0].snmpProfile).toBe('default');
    expect(created[created.length - 1].timeoutMs).toBeUndefined();
  });

  test('the flag can be set on the edit form and is shown on the device page', async () => {
    const { device } = await createDevice('FLAG-R01J-DUB-01', '10.50.5.1');
    const pop = await app.models.POP.create({ name: 'Flag POP', shortName: 'FLGP' });
    const cty = await app.models.County.create({ name: 'Flag cty', acronym: 'FLG' });
    const edit = await admin.get(`/devices/${device._id}/edit`).expect(200);
    expect(edit.text).toContain('name="device[snmpSlow]"');
    await admin
      .put(`/devices/${device._id}`)
      .type('form')
      .send({
        'device[snmpSlow]': 'true',
        'device[popName][name]': String(pop._id),
        'device[county][name]': String(cty._id),
      })
      .expect(302);
    expect(await Device.findById(device._id)).toMatchObject({ snmpSlow: true });
    const page = await admin.get(`/devices/${device._id}`).expect(200);
    expect(page.text).toContain('slow (flagged by hand)');

    const created = [];
    const run = await syncRunner.syncDevices([await Device.findById(device._id)], {
      createSession: sessionFactory({}, created),
    });
    expect(run.results[0].snmpProfile).toBe('slow');
    expect(created[0]).toMatchObject({ timeoutMs: config.snmp.slowTimeoutMs });

    const rows = await admin
      .get('/devices/pagination')
      .query({ 'filter[snmpSlow]': 'true' })
      .expect(200);
    expect(rows.body.rows.map((row) => row.hostname)).toEqual(['FLAG-R01J-DUB-01']);
  });
});
