/**
 * CRUD for /counties.
 *
 * Current-behavior notes:
 *  - `name` is the only required field; creating without it flashes an error
 *    but the response is a 302 back to /counties either way.
 *  - Edit form, update and delete are NOT protected by isLoggedIn.
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

describe('County CRUD (authenticated)', () => {
  let ctyId;

  test('INDEX: GET /counties renders the list', async () => {
    await app.models.County.create({ name: 'Preexisting-County', acronym: 'PG' });
    // the list itself is loaded by bootstrap-table from /counties/pagination
    const res = await agent.get('/counties').expect(200);
    expect(res.text).toContain('data-url="/counties/pagination"');
    const json = await agent.get('/counties/pagination').expect(200);
    expect(json.body.rows.map((r) => r.name)).toContain('Preexisting-County');
  });

  test('NEW: GET /counties/new renders the form', async () => {
    const res = await agent.get('/counties/new').expect(200);
    expect(res.text).toContain('name="county[name]"');
  });

  test('CREATE: POST /counties stores name, acronym and author', async () => {
    await agent
      .post('/counties')
      .type('form')
      .send({ 'county[name]': 'Galway', 'county[acronym]': 'GAL' })
      .expect(302)
      .expect('location', '/counties');

    const cty = await app.models.County.findOne({ name: 'Galway' });
    expect(cty).not.toBeNull();
    ctyId = String(cty._id);
    expect(cty.acronym).toBe('GAL');
    expect(cty.author.email).toBe(user.email);
  });

  test('CREATE: missing required name -> flash message and back to the form, nothing stored', async () => {
    const before = await app.models.County.countDocuments({});
    await agent
      .post('/counties')
      .type('form')
      .send({ 'county[acronym]': 'XX' })
      .expect(302)
      .expect('location', '/counties/new');
    expect(await app.models.County.countDocuments({})).toBe(before);
    const form = await agent.get('/counties/new').expect(200);
    expect(form.text).toContain('Name is required'); // the flash message
  });

  test('SHOW: GET /counties/:id renders the county', async () => {
    const res = await agent.get('/counties/' + ctyId).expect(200);
    expect(res.text).toContain('Galway');
  });

  test('SHOW/EDIT: non-existent or malformed ids respond 404 (not-found page)', async () => {
    const missing = new app.mongoose.Types.ObjectId();
    const res = await agent.get('/counties/' + missing).expect(404);
    expect(res.text).toContain('County ');
    expect(res.text).toContain(String(missing) + '&#34; does not exist');
    await agent.get('/counties/' + missing + '/edit').expect(404);
    await agent.get('/counties/not-an-object-id').expect(404); // used to hang forever
    await agent.get('/counties/not-an-object-id/edit').expect(404);
  });

  test('EDIT: GET /counties/:id/edit renders the form', async () => {
    const res = await agent.get('/counties/' + ctyId + '/edit').expect(200);
    expect(res.text).toContain('Galway');
  });

  test('UPDATE: PUT /counties/:id updates and redirects to show', async () => {
    await agent
      .put('/counties/' + ctyId)
      .type('form')
      .send({ 'county[name]': 'Galway-Renamed', 'county[acronym]': 'GAL2' })
      .expect(302)
      .expect('location', '/counties/' + ctyId);
    const cty = await app.models.County.findById(ctyId);
    expect(cty.name).toBe('Galway-Renamed');
    expect(cty.acronym).toBe('GAL2');
  });

  test('PAGINATION: GET /counties/pagination returns bootstrap-table {total, rows} (select2 ids)', async () => {
    const res = await agent
      .get('/counties/pagination')
      .query({ limit: 500, search: 'Galway-Renamed' })
      .expect(200)
      .expect('content-type', /json/);
    expect(res.body.total).toBe(1);
    expect(res.body.rows[0]).toMatchObject({ name: 'Galway-Renamed', acronym: 'GAL2', id: ctyId });
  });

  test('DESTROY: DELETE /counties/:id removes the county', async () => {
    await agent
      .delete('/counties/' + ctyId)
      .expect(302)
      .expect('location', '/counties');
    expect(await app.models.County.findById(ctyId)).toBeNull();
  });
});

describe('County routes that skip the login guard (current behavior)', () => {
  test('anonymous users can edit, update and delete counties', async () => {
    const cty = await app.models.County.create({ name: 'Anon-Cty', acronym: 'AG' });

    await app
      .anon()
      .get('/counties/' + cty._id + '/edit')
      .expect(200);

    await app
      .anon()
      .put('/counties/' + cty._id)
      .type('form')
      .send({ 'county[name]': 'Anon-Edited' })
      .expect(302)
      .expect('location', '/counties/' + cty._id);
    expect((await app.models.County.findById(cty._id)).name).toBe('Anon-Edited');

    await app
      .anon()
      .delete('/counties/' + cty._id)
      .expect(302)
      .expect('location', '/counties');
    expect(await app.models.County.findById(cty._id)).toBeNull();
  });
});
