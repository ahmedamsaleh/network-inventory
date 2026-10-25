/**
 * CRUD for /pops.
 *
 * Current-behavior notes (asserted below):
 *  - POST /pops stores name/shortName + the flat cty/district/sector/popType/
 *    popLongName fields (defaults "Unknown"), pop_cty = shortName_cty.
 *  - Edit form, update and delete are NOT protected by isLoggedIn.
 *  - Showing a well-formed but non-existent id responds 500 (the handler
 *    renders with pop = null).
 */
const { bootApp, authedAgent } = require('./helpers/boot');

let app;
let agent;
let user;

beforeAll(async () => {
  app = await bootApp();
  ({ agent, user } = await authedAgent(app));
});

afterAll(async () => {
  await app.close();
});

describe('POP CRUD (authenticated)', () => {
  let popId;

  test('INDEX: GET /pops renders the list', async () => {
    await app.models.POP.create({ name: 'Preexisting-POP', shortName: 'PRE' });
    const res = await agent.get('/pops').expect(200);
    expect(res.text).toContain('data-url="/pops/pagination"');
    const json = await agent.get('/pops/pagination').expect(200);
    expect(json.body.rows.map((r) => r.name)).toContain('Preexisting-POP');
  });

  test('NEW: GET /pops/new renders the form', async () => {
    const res = await agent.get('/pops/new').expect(200);
    expect(res.text).toContain('name="pop[name]"');
  });

  test('CREATE: POST /pops stores the pop with the session user as author', async () => {
    await agent
      .post('/pops')
      .type('form')
      .send(
        'pop[name]=Howth&pop[shortName]=HWT&pop[countyAcro]=GAL&pop[district]=West&pop[sector]=S1'
      )
      .expect(302)
      .expect('location', '/pops');

    const pop = await app.models.POP.findOne({ name: 'Howth' });
    expect(pop).not.toBeNull();
    popId = String(pop._id);
    expect(pop.shortName).toBe('HWT');
    expect(pop.district).toBe('West');
    expect(pop.author.email).toBe(user.email);
    expect(String(pop.author.id)).toBe(String(user._id));
    // the form's countyAcro/sector strings now land on the flat fields
    expect(pop.cty).toBe('GAL');
    expect(pop.sector).toBe('S1');
    expect(pop.pop_cty).toBe('HWT_GAL');
    expect(pop.popType).toBe('Unknown');
    expect(pop.popLongName).toBe('Unknown');
  });

  test('SHOW: GET /pops/:id renders the pop', async () => {
    const res = await agent.get('/pops/' + popId).expect(200);
    expect(res.text).toContain('Howth');
  });

  test('SHOW/EDIT: non-existent or malformed ids respond 404 (not-found page)', async () => {
    const missing = new app.mongoose.Types.ObjectId();
    const res = await agent.get('/pops/' + missing).expect(404);
    expect(res.text).toContain('POP ');
    expect(res.text).toContain(String(missing) + '&#34; does not exist');
    await agent.get('/pops/' + missing + '/edit').expect(404);
    await agent.get('/pops/not-an-object-id').expect(404); // used to hang forever
    await agent.get('/pops/not-an-object-id/edit').expect(404);
  });

  test('EDIT: GET /pops/:id/edit renders the form', async () => {
    const res = await agent.get('/pops/' + popId + '/edit').expect(200);
    expect(res.text).toContain('Howth');
  });

  test('UPDATE: PUT /pops/:id updates and redirects to the show page', async () => {
    await agent
      .put('/pops/' + popId)
      .type('form')
      .send('pop[name]=Howth-2&pop[shortName]=HW2&pop[district]=East')
      .expect(302)
      .expect('location', '/pops/' + popId);
    const pop = await app.models.POP.findById(popId);
    expect(pop.name).toBe('Howth-2');
    expect(pop.shortName).toBe('HW2');
    expect(pop.district).toBe('East');
  });

  test('UPDATE also works through method-override (POST + ?_method=PUT)', async () => {
    await agent
      .post('/pops/' + popId + '?_method=PUT')
      .type('form')
      .send('pop[name]=Howth-3')
      .expect(302)
      .expect('location', '/pops/' + popId);
    expect((await app.models.POP.findById(popId)).name).toBe('Howth-3');
  });

  test('PAGINATION: GET /pops/pagination returns bootstrap-table {total, rows}', async () => {
    const res = await agent.get('/pops/pagination').expect(200).expect('content-type', /json/);
    expect(typeof res.body.total).toBe('number');
    expect(Array.isArray(res.body.rows)).toBe(true);
    const row = res.body.rows.find((r) => r.name === 'Howth-3');
    expect(row).toMatchObject({ id: popId, _id: popId, acronym: 'HW2', district: 'East' });
    expect(row.shortName).toBeUndefined(); // flat rows with the displayed names only
  });

  test('DESTROY: DELETE /pops/:id removes the pop', async () => {
    await agent
      .delete('/pops/' + popId)
      .expect(302)
      .expect('location', '/pops');
    expect(await app.models.POP.findById(popId)).toBeNull();
  });
});

describe('POP routes that skip the login guard (current behavior)', () => {
  test('anonymous users can edit, update and delete pops', async () => {
    const pop = await app.models.POP.create({ name: 'Anon-POP', shortName: 'AP' });

    await app
      .anon()
      .get('/pops/' + pop._id + '/edit')
      .expect(200);

    await app
      .anon()
      .put('/pops/' + pop._id)
      .type('form')
      .send('pop[name]=Anon-Edited')
      .expect(302)
      .expect('location', '/pops/' + pop._id);
    expect((await app.models.POP.findById(pop._id)).name).toBe('Anon-Edited');

    await app
      .anon()
      .delete('/pops/' + pop._id)
      .expect(302)
      .expect('location', '/pops');
    expect(await app.models.POP.findById(pop._id)).toBeNull();
  });
});

describe('POP model extension and "POPs" sheet import', () => {
  test('defaults "Unknown", pop_cty = shortName_cty, recomputed on update', async () => {
    const { POP } = app.models;
    const pop = await POP.create({ name: 'Ongar', shortName: 'ONGAR', cty: 'D' });
    expect(pop).toMatchObject({
      district: 'Unknown',
      sector: 'Unknown',
      popType: 'Unknown',
      popLongName: 'Unknown',
      pop_cty: 'ONGAR_D',
    });
    expect((await POP.create({ name: 'x', shortName: 'NOCTY' })).pop_cty).toBe('Unknown');
    // the legacy countyAcro relation still feeds cty
    expect(
      (await POP.create({ name: 'y', shortName: 'LEG', countyAcro: { acronym: 'DUB' } })).pop_cty
    ).toBe('LEG_DUB');

    await agent
      .put('/pops/' + pop._id)
      .type('form')
      .send({
        'pop[cty]': ' WIK ',
        'pop[district]': '',
        'pop[popType]': ' Core ',
        'pop[popLongName]': 'Ongar main POP',
      })
      .expect(302);
    const updated = await POP.findById(pop._id);
    expect(updated).toMatchObject({
      cty: 'WIK',
      district: 'Unknown',
      popType: 'Core',
      popLongName: 'Ongar main POP',
      pop_cty: 'ONGAR_WIK',
    });
  });

  test('new/edit/show/index expose the fields', async () => {
    const { POP } = app.models;
    const pop = await POP.create({
      name: 'View POP',
      shortName: 'VIEW',
      cty: 'DUB',
      popType: 'Edge',
      popLongName: 'View long',
    });
    const newForm = await agent.get('/pops/new').expect(200);
    for (const field of ['cty', 'district', 'sector', 'popType', 'popLongName'])
      expect(newForm.text).toContain(`name="pop[${field}]"`);
    const edit = await agent.get('/pops/' + pop._id + '/edit').expect(200);
    expect(edit.text).toContain('value="VIEW_DUB"');
    const show = await agent.get('/pops/' + pop._id).expect(200);
    expect(show.text).toContain('<th>pop_cty</th>');
    expect(show.text).toContain('VIEW_DUB');
    expect(show.text).toContain('View long');
    const index = await agent.get('/pops').expect(200);
    expect(index.text).toContain('data-field="popType"');
    expect(index.text).toContain('action="/pops/import"');
    const rows = (await agent.get('/pops/pagination').query({ search: 'VIEW_DUB' }).expect(200))
      .body.rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      acronym: 'VIEW',
      cty: 'DUB',
      popType: 'Edge',
      popLongName: 'View long',
      pop_cty: 'VIEW_DUB',
      sector: 'Unknown',
    });
  });

  test('POST /pops/import upserts POPs from the sheet (header skipped, blanks -> Unknown, pop_cty computed)', async () => {
    const { POP } = app.models;
    await POP.create({
      name: 'Old Centra',
      shortName: 'CENTRA2',
      cty: 'OLD',
      district: 'Old district',
    });
    const csv = [
      'shortName,cty,district,sector,popType,popLongName',
      'ONGAR2,D,Ongar district,Sector North,Core,Ongar main POP',
      'centra2,DUB,,,Edge,',
      ',DUB,no short name',
      'WIKLOW,WIK',
    ].join('\n');
    const res = await agent
      .post('/pops/import')
      .attach('file', Buffer.from(csv), 'pops.csv')
      .expect(302)
      .expect('location', '/pops');
    void res;
    const ongar = await POP.findOne({ shortName: 'ONGAR2' });
    expect(ongar).toMatchObject({
      name: 'Ongar main POP',
      cty: 'D',
      district: 'Ongar district',
      sector: 'Sector North',
      popType: 'Core',
      popLongName: 'Ongar main POP',
      pop_cty: 'ONGAR2_D',
    });
    const centra = await POP.findOne({ shortName: 'CENTRA2' });
    expect(centra).toMatchObject({
      name: 'Old Centra',
      cty: 'DUB',
      district: 'Unknown',
      sector: 'Unknown',
      popType: 'Edge',
      popLongName: 'Unknown',
      pop_cty: 'CENTRA2_DUB',
    });
    expect(await POP.countDocuments({ shortName: /centra2/i })).toBe(1); // updated, not duplicated
    const wiklow = await POP.findOne({ shortName: 'WIKLOW' });
    expect(wiklow).toMatchObject({ cty: 'WIK', district: 'Unknown', pop_cty: 'WIKLOW_WIK' });
    expect(await POP.countDocuments({ shortName: '' })).toBe(0);
    // no file -> back to the list with a message, nothing imported
    await agent.post('/pops/import').expect(302).expect('location', '/pops');
    // anonymous -> login
    await app.anon().post('/pops/import').expect(302).expect('location', '/login');
  });
});
