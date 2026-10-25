/**
 * CRUD for /btmsaninfos (BT MSAN reference data).
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

describe('BTMSANInfo CRUD (authenticated)', () => {
  let id;

  test('all routes are guarded', async () => {
    const fake = new app.mongoose.Types.ObjectId();
    for (const url of [
      '/btmsaninfos',
      '/btmsaninfos/pagination',
      '/btmsaninfos/new',
      '/btmsaninfos/' + fake,
      '/btmsaninfos/' + fake + '/edit',
    ]) {
      await app.anon().get(url).expect(302).expect('location', '/login');
    }
    await app
      .anon()
      .post('/btmsaninfos')
      .type('form')
      .send({})
      .expect(302)
      .expect('location', '/login');
    await app
      .anon()
      .put('/btmsaninfos/' + fake)
      .type('form')
      .send({})
      .expect(302)
      .expect('location', '/login');
    await app
      .anon()
      .delete('/btmsaninfos/' + fake)
      .expect(302)
      .expect('location', '/login');
  });

  test('INDEX / NEW render', async () => {
    const index = await agent.get('/btmsaninfos').expect(200);
    expect(index.text).toContain('data-url="/btmsaninfos/pagination"');
    expect(index.text).toContain('href="/btmsaninfos"'); // header link
    const form = await agent.get('/btmsaninfos/new').expect(200);
    for (const field of ['msanCode', 'mngIP', 'sector', 'district', 'notes'])
      expect(form.text).toContain(`name="btmsaninfo[${field}]"`);
  });

  test('CREATE stores trimmed fields with defaults; missing/duplicate code rejected', async () => {
    await agent
      .post('/btmsaninfos')
      .type('form')
      .send({
        'btmsaninfo[msanCode]': ' MSAN-ONGAR-01 ',
        'btmsaninfo[mngIP]': ' 10.200.0.1 ',
        'btmsaninfo[sector]': '',
        'btmsaninfo[district]': 'Ongar',
      })
      .expect(302)
      .expect('location', '/btmsaninfos');
    const info = await app.models.BTMSANInfo.findOne({ msanCode: 'MSAN-ONGAR-01' });
    expect(info).toMatchObject({
      mngIP: '10.200.0.1',
      sector: 'Unknown',
      district: 'Ongar',
      notes: '',
    });
    expect(info.author.email).toBe('admin@example.com');
    id = String(info._id);
    await agent
      .post('/btmsaninfos')
      .type('form')
      .send({ 'btmsaninfo[mngIP]': '10.0.0.1' })
      .expect(302)
      .expect('location', '/btmsaninfos/new');
    await agent
      .post('/btmsaninfos')
      .type('form')
      .send({ 'btmsaninfo[msanCode]': 'msan-ongar-01' })
      .expect(302)
      .expect('location', '/btmsaninfos/new');
    expect(await app.models.BTMSANInfo.countDocuments({})).toBe(1);
  });

  test('SHOW / EDIT / UPDATE / PAGINATION / 404 / DESTROY', async () => {
    expect((await agent.get('/btmsaninfos/' + id).expect(200)).text).toContain('10.200.0.1');
    expect((await agent.get('/btmsaninfos/' + id + '/edit').expect(200)).text).toContain(
      'value="MSAN-ONGAR-01"'
    );
    await agent.get('/btmsaninfos/' + new app.mongoose.Types.ObjectId()).expect(404);
    await agent.get('/btmsaninfos/nope/edit').expect(404);
    await agent
      .put('/btmsaninfos/' + id)
      .type('form')
      .send({ 'btmsaninfo[sector]': ' East ', 'btmsaninfo[district]': '' })
      .expect(302)
      .expect('location', '/btmsaninfos/' + id);
    const updated = await app.models.BTMSANInfo.findById(id);
    expect(updated).toMatchObject({ sector: 'East', district: 'Unknown', mngIP: '10.200.0.1' });
    expect(updated.lastUpdate).toBeInstanceOf(Date);
    const page = await agent.get('/btmsaninfos/pagination').query({ search: '10.200' }).expect(200);
    expect(page.body.total).toBe(1);
    expect(page.body.rows[0]).toMatchObject({
      _id: id,
      msanCode: 'MSAN-ONGAR-01',
      sector: 'East',
      createdBy: 'admin@example.com',
    });
    expect(await app.models.BTMSANInfo.findByCode('msan-ongar-01')).not.toBeNull();
    expect(await app.models.BTMSANInfo.findByMngIP('10.200.0.1')).not.toBeNull();
    await agent
      .delete('/btmsaninfos/' + id)
      .expect(302)
      .expect('location', '/btmsaninfos');
    expect(await app.models.BTMSANInfo.findById(id)).toBeNull();
  });
});
