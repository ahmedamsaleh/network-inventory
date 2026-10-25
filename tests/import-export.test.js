/**
 * Bulk device import (CSV / XLSX, streamed, batched), exports (CSV / XLSX /
 * ZIP) honoring the unified criteria, the secondPOP check and the external API.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');
const { parse: parseCsvSync } = require('csv-parse/sync');
const { bootApp, adminAgent, sleep } = require('./helpers/boot');

let app;
let agent;
let importDevices;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ni-import-'));

const binary = (res, callback) => {
  const chunks = [];
  res.on('data', (chunk) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
};

beforeAll(async () => {
  app = await bootApp();
  agent = await adminAgent(app);
  importDevices = require('../services/importDevices');
});

afterAll(async () => {
  await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('bulk device import', () => {
  test('CSV: valid rows are upserted by hostname, every bad row is reported with its row number', async () => {
    const file = path.join(tmp, 'devices.csv');
    fs.writeFileSync(
      file,
      [
        'Hostname,IP Address,Community String,Type,Vendor,Model,POP,bogus',
        'DUBP-RCJ1-DUB-01,10.50.0.1,public,Router,Juniper,MX480,DUBP,ignored',
        'DUBP-SCJ1-DUB-02,10.50.0.2,public,Switch,,,,',
        'CORP-MZZ1-COR-01, 10.50.0.3 , zte-community ,MSAN,ZTE,C300,CORP,',
        'bad-ip-host,10.50.0.999,public,,,,,', // invalid IP
        ',10.50.0.5,public,,,,,', // missing hostname
        'DUBP-RCJ1-DUB-09,10.50.0.6,,,,,,', // missing community
        'tiny,10.50.0.7,public,,,,,', // hostname too short
        'DUBP-SCJ1-DUB-02,10.50.0.8,public,,,,,', // duplicate hostname in file
        'DUBP-SCJ1-DUB-03,10.50.0.2,public,,,,,', // duplicate IP in file
        '',
      ].join('\n')
    );
    const report = await importDevices.importDevices(file, {
      author: { email: 'importer@example.com' },
    });
    expect(report).toMatchObject({ status: 'done', total: 9, inserted: 3, updated: 0, failed: 6 });
    expect(report.unknownHeaders).toEqual(['bogus']);
    expect(report.errors.map((e) => [e.row, e.message])).toEqual([
      [5, 'IP address is not valid'],
      [6, 'hostname is required'],
      [7, 'community is required'],
      [8, 'hostname is too short'],
      [9, 'duplicate hostname in file (row 3)'],
      [10, 'duplicate IP address in file (row 3)'],
    ]);
    const msan = await app.models.Device.findOne({ hostname: 'CORP-MZZ1-COR-01' });
    expect(msan).toMatchObject({
      ipaddress: '10.50.0.3',
      community: 'zte-community',
      communityString: 'zte-community',
      type: 'MSAN',
      vendor: 'ZTE',
      model: 'C300',
      pop: 'CORP',
      discovered: false,
    });
    expect(msan.author.email).toBe('importer@example.com');

    // re-import: updates, and an IP already used by another device is refused
    fs.writeFileSync(
      file,
      [
        'hostname,ipaddress,community',
        'DUBP-RCJ1-DUB-01,10.50.0.1,changed',
        'DUBP-NEW1-DUB-05,10.50.0.2,public',
      ].join('\n')
    );
    const again = await importDevices.importDevices(file);
    expect(again).toMatchObject({ total: 2, inserted: 0, updated: 1, failed: 1 });
    expect(again.errors[0].message).toBe('IP address already used by DUBP-SCJ1-DUB-02');
    expect((await app.models.Device.findOne({ hostname: 'DUBP-RCJ1-DUB-01' })).community).toBe(
      'changed'
    );
    // missing required column -> failed report, nothing imported
    fs.writeFileSync(file, 'hostname,type\nX-RCJ1-Y-01,Router\n');
    const missing = await importDevices.importDevices(file);
    expect(missing.status).toBe('failed');
    expect(missing.error).toMatch(/missing required column/);
  });

  test('XLSX: rows are streamed from the chosen worksheet', async () => {
    const file = path.join(tmp, 'devices.xlsx');
    const workbook = new ExcelJS.Workbook();
    const other = workbook.addWorksheet('Other');
    other.addRow(['hostname', 'ipaddress', 'community']);
    other.addRow(['WRONG-RCJ1-DUB-01', '10.51.9.9', 'public']);
    const sheet = workbook.addWorksheet('Devices');
    sheet.addRow(['hostname', 'ipaddress', 'community', 'type']);
    sheet.addRow(['GALP-RCJ1-GAL-01', '10.51.0.1', 'public', 'Router']);
    sheet.addRow([
      { richText: [{ text: 'GALP-' }, { text: 'SCJ1-GAL-02' }] },
      '10.51.0.2',
      'public',
      'Switch',
    ]); // rich text cell
    sheet.addRow([]);
    sheet.addRow(['GALP-GCJ1-GAL-03', 'not-an-ip', 'public', 'GPON']);
    await workbook.xlsx.writeFile(file);
    const report = await importDevices.importDevices(file, { sheet: 'Devices' });
    expect(report).toMatchObject({ total: 3, inserted: 2, failed: 1 });
    expect(await app.models.Device.countDocuments({ hostname: /^GALP-/ })).toBe(2);
    expect(await app.models.Device.countDocuments({ hostname: 'WRONG-RCJ1-DUB-01' })).toBe(0);
    const first = await importDevices.importDevices(file); // default: first sheet
    expect(first).toMatchObject({ total: 1, inserted: 1 });
  });

  test('upload route starts a background import and the status endpoint reports it', async () => {
    const csv =
      'hostname,ipaddress,community\nUPLP-RCJ1-DUB-01,10.52.0.1,public\nUPLP-RCJ1-DUB-02,10.52.0.2,public\n';
    await agent
      .post('/enrichments/import/devices')
      .attach('file', Buffer.from(csv), 'upload.csv')
      .expect(302)
      .expect('location', '/enrichments/import');
    let status;
    for (let i = 0; i < 50; i++) {
      status = (await agent.get('/enrichments/import/status').expect(200)).body;
      if (status.lastImport && !status.running) break;
      await sleep(100);
    }
    expect(status.lastImport).toMatchObject({ status: 'done', total: 2, inserted: 2 });
    const page = (await agent.get('/enrichments/import').expect(200)).text;
    expect(page).toContain('upload.csv'); // last report rendered on the page
    expect(page).toContain('&#34;inserted&#34;: 2');
    await agent.post('/enrichments/import/devices').expect(302); // no file -> flash + redirect
    await app.anon().get('/enrichments/import').expect(302).expect('location', '/login');
  });

  test('50 000 rows import without growing the heap (streamed, batched bulkWrite)', async () => {
    const file = path.join(tmp, 'devices-50k.csv');
    const out = fs.createWriteStream(file);
    out.write('hostname,ipaddress,community string,type,model,vendor,pop\n');
    const types = { R: 'Router', S: 'Switch', M: 'MSAN', G: 'GPON', D: 'DSLAM' };
    const typeCodes = Object.keys(types);
    const vendors = { J: 'Juniper', H: 'Huawei', C: 'Cisco', A: 'Alcatel' };
    const vendorCodes = Object.keys(vendors);
    for (let i = 0; i < 50000; i++) {
      const t = typeCodes[i % 5];
      const v = vendorCodes[i % 4];
      const pop = 'BULK' + String(i % 100).padStart(3, '0');
      out.write(
        `${pop}-${t}${String(i % 99).padStart(2, '0')}${v}-CTY-${String(i).padStart(5, '0')},10.${100 + ((i >> 16) & 255)}.${(i >> 8) & 255}.${i & 255},public,${types[t]},MODEL-${i % 7},${vendors[v]},${pop}\n`
      );
    }
    await new Promise((resolve) => out.end(resolve));
    if (global.gc) global.gc();
    const before = process.memoryUsage().heapUsed;
    const report = await importDevices.importDevices(file);
    if (global.gc) global.gc();
    const growth = process.memoryUsage().heapUsed - before;
    expect(report).toMatchObject({ status: 'done', total: 50000, inserted: 50000, failed: 0 });
    expect(await app.models.Device.countDocuments({ hostname: /^BULK/ })).toBe(50000);
    expect(growth).toBeLessThan(150 * 1024 * 1024);
  }, 600000);
});

describe('exports with the unified criteria', () => {
  beforeAll(async () => {
    const { Device, Interface, Link, POP } = app.models;
    await Device.deleteMany({ hostname: /^BULK/ }); // keep the export fixtures small
    await POP.create({ name: 'Dublin', shortName: 'EXPP', cty: 'DUB' });
    const router = await Device.create({
      hostname: 'EXPP-RCJ1-DUB-01',
      ipaddress: '10.60.0.1',
      type: 'Router',
      vendor: 'Juniper',
      model: 'MX480',
      pop: 'EXPP',
      lastSyncTime: new Date('2024-06-01T00:00:00Z'),
      interfaces: [
        {
          name: 'xe-0/0/0',
          index: 1,
          alias: 'INT-IPT-Cogent-DUB-10GIG-B2-NB-L22-1_300050661-EIG_IPT_10G_0019-EIG',
          description: 'xe-0/0/0',
          speed: 10e9,
        },
        { name: 'ge-0/0/1', index: 2, alias: 'plain', description: 'ge-0/0/1', speed: 1e9 },
      ],
    });
    await Device.create({
      hostname: 'EXPP-SHH1-DUB-02',
      ipaddress: '10.60.0.2',
      type: 'Switch',
      vendor: 'Huawei',
      model: 'S5720',
      pop: 'EXPP',
      lastSyncTime: new Date('2023-01-01T00:00:00Z'),
    });
    await Device.create({
      hostname: 'EXPP-MZZ1-DUB-03',
      ipaddress: '10.60.0.3',
      type: 'MSAN',
      vendor: 'ZTE',
      pop: 'EXPP',
    });
    await Interface.create({
      ifName: 'xe-0/0/0',
      ifIndex: 1,
      ifAlias: 'INT-...',
      hostname: router.hostname,
      specialService: 'International',
      speedCat: '10G',
      apiFlag: false,
      secondHost: 'EXPP-SHH1-DUB-02',
      secondPOP: 'EXPP_DUB',
      device: { hostname: router.hostname },
    });
    await Interface.create({
      ifName: 'ge-0/0/1',
      ifIndex: 2,
      hostname: router.hostname,
      specialService: 'Bitstream',
      speedCat: '1G',
      apiFlag: true,
      secondHost: 'EXPP-MZZ1-DUB-03',
      secondPOP: 'WRONG',
      device: { hostname: router.hostname },
    });
    await Interface.create({
      ifName: 'ge-0/0/2',
      ifIndex: 3,
      hostname: router.hostname,
      specialService: '',
      speedCat: 'Unknown',
      secondHost: 'NOLINK-RCJ1-DUB-09',
      device: { hostname: router.hostname },
    });
    await Link.create({
      device1: router.hostname,
      interface1: 'xe-0/0/0',
      device2: 'EXPP-SHH1-DUB-02',
      interface2: 'xe-0/0/9',
    });
    await Link.create({
      device1: router.hostname,
      interface1: 'ge-0/0/1',
      device2: 'EXPP-MZZ1-DUB-03',
      interface2: 'ge-0/1/1',
    });
  });

  test('GET /enrichments/export renders the form (datasets, formats, criteria, CSV warning)', async () => {
    const res = await agent.get('/enrichments/export').expect(200);
    for (const name of [
      'devices',
      'interfaces',
      'pops',
      'cabinets',
      'devicemodels',
      'btmsaninfos',
      'links',
      'enrichment',
      'secondpop_check',
    ]) {
      expect(res.text).toContain('value="' + name + '"');
    }
    expect(res.text).toContain('multiple files');
    expect(res.text).toContain('name="filter[lastSyncTime][from]"');
  });

  test('CSV of one dataset honors every criterion and matches the pagination endpoint', async () => {
    const query = {
      datasets: 'devices',
      format: 'csv',
      'filter[type]': 'Router,Switch',
      'filter[vendor][like]': 'uawei',
      'filter[pop]': 'expp',
    };
    const res = await agent
      .get('/enrichments/export/download')
      .query(query)
      .expect(200)
      .expect('content-type', /text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/devices-.*\.csv/);
    const rows = parseCsvSync(res.text, { columns: true });
    expect(rows.map((r) => r.hostname)).toEqual(['EXPP-SHH1-DUB-02']);
    expect(Object.keys(rows[0])).toEqual(
      expect.arrayContaining(['hostname', 'ipaddress', 'type', 'vendor', 'pop', 'lastSyncTime'])
    );
    const page = await agent
      .get('/devices/pagination')
      .query({
        'filter[type]': 'Router,Switch',
        'filter[vendor][like]': 'uawei',
        'filter[pop]': 'expp',
      })
      .expect(200);
    expect(page.body.total).toBe(1);
    expect(page.body.rows[0].hostname).toBe('EXPP-SHH1-DUB-02');
    // date range + search + boolean criteria
    const recent = parseCsvSync(
      (
        await agent
          .get('/enrichments/export/download')
          .query({
            datasets: 'devices',
            format: 'csv',
            'filter[lastSyncTime][from]': '2024-01-01',
            search: 'expp',
          })
          .expect(200)
      ).text,
      { columns: true }
    );
    expect(recent.map((r) => r.hostname)).toEqual(['EXPP-RCJ1-DUB-01']);
    const flagged = parseCsvSync(
      (
        await agent
          .get('/enrichments/export/download')
          .query({
            datasets: 'interfaces',
            format: 'csv',
            'filter[apiFlag]': 'true',
            'filter[hostname]': 'EXPP-RCJ1-DUB-01',
          })
          .expect(200)
      ).text,
      { columns: true }
    );
    expect(flagged.map((r) => r.ifName)).toEqual(['ge-0/0/1']);
    const speed = parseCsvSync(
      (
        await agent
          .get('/enrichments/export/download')
          .query({
            datasets: 'interfaces',
            format: 'csv',
            'filter[speedCat]': '10G,1G',
            'filter[specialService][ne]': 'Bitstream',
            'filter[hostname]': 'EXPP-RCJ1-DUB-01',
          })
          .expect(200)
      ).text,
      { columns: true }
    );
    expect(speed.map((r) => r.ifName)).toEqual(['xe-0/0/0']);
  });

  test('XLSX of several datasets is one workbook with one sheet per dataset, criteria applied to each', async () => {
    const res = await agent
      .get('/enrichments/export/download')
      .query({
        datasets: ['devices', 'interfaces', 'enrichment'],
        format: 'xlsx',
        'filter[hostname][like]': 'EXPP-RCJ1',
      })
      .buffer(true)
      .parse(binary)
      .expect(200)
      .expect('content-type', /spreadsheetml/);
    expect(res.headers['content-disposition']).toMatch(/inventory-.*\.xlsx/);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body);
    expect(workbook.worksheets.map((s) => s.name)).toEqual(['devices', 'interfaces', 'enrichment']);
    const devices = workbook.getWorksheet('devices');
    expect(devices.getRow(1).values.slice(1)).toEqual(
      expect.arrayContaining(['hostname', 'ipaddress'])
    );
    expect(devices.rowCount).toBe(2); // header + the one matching device
    expect(workbook.getWorksheet('interfaces').rowCount).toBe(4); // header + 3 interfaces of that device
    const enrichment = workbook.getWorksheet('enrichment');
    expect(enrichment.getRow(1).values.slice(1)[0]).toBe('SE_Name');
    expect(enrichment.rowCount).toBe(3); // device row + the International interface (the plain alias is skipped)
    expect(enrichment.getRow(3).values.slice(1)).toEqual(
      expect.arrayContaining(['EXPP-RCJ1-DUB-01_if<1>', 'International', 'SRV-IPT', 'Cogent'])
    );
  });

  test('CSV of several datasets is delivered as a ZIP with one CSV per dataset', async () => {
    const res = await agent
      .get('/enrichments/export/download')
      .query({ datasets: 'devices,pops', format: 'csv', 'filter[pop]': 'EXPP' })
      .buffer(true)
      .parse(binary)
      .expect(200)
      .expect('content-type', /application\/zip/);
    expect(res.body.subarray(0, 2).toString()).toBe('PK');
    const text = res.body.toString('latin1');
    expect(text).toContain('devices.csv');
    expect(text).toContain('pops.csv');
  });

  test('markApiFlag flags the exported interfaces; unknown dataset is refused', async () => {
    await agent
      .get('/enrichments/export/download')
      .query({
        datasets: 'interfaces',
        format: 'csv',
        'filter[hostname]': 'EXPP-RCJ1-DUB-01',
        'filter[specialService]': 'International',
        markApiFlag: '1',
      })
      .expect(200);
    expect(
      (await app.models.Interface.findOne({ hostname: 'EXPP-RCJ1-DUB-01', ifName: 'xe-0/0/0' }))
        .apiFlag
    ).toBe(true);
    expect(
      (await app.models.Interface.findOne({ hostname: 'EXPP-RCJ1-DUB-01', ifName: 'ge-0/0/2' }))
        .apiFlag
    ).toBe(false);
    await agent
      .get('/enrichments/export/download')
      .query({ datasets: 'nope', format: 'csv' })
      .expect(302)
      .expect('location', '/enrichments/export');
    await app
      .anon()
      .get('/enrichments/export/download')
      .query({ datasets: 'devices' })
      .expect(302)
      .expect('location', '/login');
  });

  test('secondPOP check compares interfaces with the Link collection', async () => {
    const res = await agent
      .get('/enrichments/check/secondpop')
      .query({ 'filter[hostname]': 'EXPP-RCJ1-DUB-01' })
      .expect(200);
    const byName = Object.fromEntries(res.body.rows.map((r) => [r.ifName, r]));
    expect(res.body).toMatchObject({ total: 3, ok: 1, problems: 2 });
    expect(byName['xe-0/0/0']).toMatchObject({
      status: 'ok',
      linkPartner: 'EXPP-SHH1-DUB-02',
      expectedPOP: 'EXPP_DUB',
    });
    expect(byName['ge-0/0/1']).toMatchObject({
      status: 'mismatch',
      secondPOP: 'WRONG',
      expectedPOP: 'EXPP_DUB',
    });
    expect(byName['ge-0/0/2']).toMatchObject({ status: 'no-link' });
    const csv = await agent
      .get('/enrichments/check/secondpop')
      .query({ format: 'csv', 'filter[hostname]': 'EXPP-RCJ1-DUB-01' })
      .expect(200)
      .expect('content-type', /text\/csv/);
    expect(parseCsvSync(csv.text, { columns: true })).toHaveLength(3);
  });

  test('external API: x-api-key or session, same criteria, apiFlag update', async () => {
    await app.anon().get('/enrichments/api/devices').set('x-api-key', 'wrong').expect(401);
    await app.anon().get('/enrichments/api/devices').set('Accept', 'application/json').expect(401);
    const res = await app
      .anon()
      .get('/enrichments/api/devices')
      .set('x-api-key', 'test-api-key')
      .query({ 'filter[pop]': 'EXPP', 'filter[type]': 'MSAN' })
      .expect(200);
    expect(res.body.total).toBe(1);
    expect(res.body.rows[0].hostname).toBe('EXPP-MZZ1-DUB-03');
    await app.anon().get('/enrichments/api/unknown').set('x-api-key', 'test-api-key').expect(404);
    const sessionRes = await agent
      .get('/enrichments/api/interfaces')
      .query({ 'filter[hostname]': 'EXPP-RCJ1-DUB-01', 'filter[apiFlag]': 'false' })
      .expect(200);
    expect(sessionRes.body.rows.map((r) => r.ifName)).toEqual(['ge-0/0/2']);
    const target = await app.models.Interface.findOne({
      hostname: 'EXPP-RCJ1-DUB-01',
      ifName: 'ge-0/0/2',
    });
    const update = await app
      .anon()
      .post('/enrichments/api/interfaces/apiflag')
      .set('x-api-key', 'test-api-key')
      .send({ ids: [String(target._id), 'not-an-id'], apiFlag: true })
      .expect(200);
    expect(update.body).toMatchObject({ matched: 1, modified: 1, apiFlag: true });
    expect((await app.models.Interface.findById(target._id)).apiFlag).toBe(true);
  });
});

describe('committed sample workbook (samples/devices-sample.xlsx)', () => {
  test('imports its 12 000 mixed devices and its POPs sheet', async () => {
    const file = path.join(__dirname, '..', 'samples', 'devices-sample.xlsx');
    const report = await importDevices.importDevices(file, { sheet: 'Devices' });
    expect(report).toMatchObject({ status: 'done', total: 12000, inserted: 12000, failed: 0 });
    const { Device, POP } = app.models;
    for (const type of ['Router', 'Switch', 'MSAN', 'GPON', 'DSLAM']) {
      expect(
        await Device.countDocuments({
          type,
          hostname: /-(DUB|GAL|COR|LIM|WAT|KER|MAY|SLI|DON|KLK|WEX|MEA)-/,
        })
      ).toBeGreaterThan(1000);
    }
    const pops = await require('../middleware/import_enrichment').importPops(file, {
      sheet: 'POPs',
    });
    expect(pops).toMatchObject({ total: 120, created: 120, skipped: 0 });
    expect(await POP.findOne({ shortName: 'DUBP01' })).toMatchObject({
      cty: 'DUB',
      pop_cty: 'DUBP01_DUB',
      popType: 'Core',
    });
  }, 300000);
});
