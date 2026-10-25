/**
 * CRUD for /sectors.
 *
 * Current-behavior notes (asserted below):
 *  - POST /sectors maps the submitted `sector[description]` into a
 *    `shortName` property that does not exist on the schema, so the
 *    description is silently discarded and never stored.
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

describe('Sector CRUD (authenticated)', () => {
  let sectorId;

  test('INDEX: GET /sectors renders the list', async () => {
    await app.models.Sector.create({ name: 'Preexisting-Sector' });
    const res = await agent.get('/sectors').expect(200);
    expect(res.text).toContain('Preexisting-Sector');
  });

  test('NEW: GET /sectors/new renders the form', async () => {
    const res = await agent.get('/sectors/new').expect(200);
    expect(res.text).toContain('name="sector[name]"');
  });

  test('CREATE: POST /sectors stores name + author but silently drops the description', async () => {
    await agent
      .post('/sectors')
      .type('form')
      .send({ 'sector[name]': 'Dublin-North', 'sector[description]': 'the north sector' })
      .expect(302)
      .expect('location', '/sectors');

    const sector = await app.models.Sector.findOne({ name: 'Dublin-North' });
    expect(sector).not.toBeNull();
    sectorId = String(sector._id);
    expect(sector.author.email).toBe(user.email);
    // ODD: the route builds {name, shortName: description, author}; the
    // schema has no `shortName` path, so the description never reaches the DB.
    expect(sector.description).toBeUndefined();
    expect(sector.toObject().shortName).toBeUndefined();
  });

  test('SHOW: GET /sectors/:id renders the sector', async () => {
    const res = await agent.get('/sectors/' + sectorId).expect(200);
    expect(res.text).toContain('Dublin-North');
  });

  test('SHOW/EDIT: non-existent or malformed ids respond 404 (not-found page)', async () => {
    const missing = new app.mongoose.Types.ObjectId();
    const res = await agent.get('/sectors/' + missing).expect(404);
    expect(res.text).toContain('Sector ');
    expect(res.text).toContain(String(missing) + '&#34; does not exist');
    await agent.get('/sectors/' + missing + '/edit').expect(404);
    await agent.get('/sectors/not-an-object-id').expect(404); // used to hang forever
    await agent.get('/sectors/not-an-object-id/edit').expect(404);
  });

  test('EDIT: GET /sectors/:id/edit renders the form', async () => {
    const res = await agent.get('/sectors/' + sectorId + '/edit').expect(200);
    expect(res.text).toContain('Dublin-North');
  });

  test('UPDATE: PUT /sectors/:id updates (description works here) and redirects', async () => {
    await agent
      .put('/sectors/' + sectorId)
      .type('form')
      .send({ 'sector[name]': 'Dublin-South', 'sector[description]': 'renamed' })
      .expect(302)
      .expect('location', '/sectors/' + sectorId);
    const sector = await app.models.Sector.findById(sectorId);
    expect(sector.name).toBe('Dublin-South');
    // unlike CREATE, UPDATE passes request.body.sector straight through,
    // so the description IS persisted on update
    expect(sector.description).toBe('renamed');
  });

  test('PAGINATION: GET /sectors/pagination returns JSON (limit 500)', async () => {
    const res = await agent.get('/sectors/pagination').expect(200).expect('content-type', /json/);
    expect(res.body).toMatchObject({ limit: 500 });
    expect(res.body.docs.map((d) => d.name)).toContain('Dublin-South');
  });

  test('DESTROY: DELETE /sectors/:id removes the sector', async () => {
    await agent
      .delete('/sectors/' + sectorId)
      .expect(302)
      .expect('location', '/sectors');
    expect(await app.models.Sector.findById(sectorId)).toBeNull();
  });
});

describe('Sector routes that skip the login guard (current behavior)', () => {
  test('anonymous users can edit, update and delete sectors', async () => {
    const sector = await app.models.Sector.create({ name: 'Anon-Sector' });

    await app
      .anon()
      .get('/sectors/' + sector._id + '/edit')
      .expect(200);

    await app
      .anon()
      .put('/sectors/' + sector._id)
      .type('form')
      .send({ 'sector[name]': 'Anon-Edited' })
      .expect(302)
      .expect('location', '/sectors/' + sector._id);
    expect((await app.models.Sector.findById(sector._id)).name).toBe('Anon-Edited');

    await app
      .anon()
      .delete('/sectors/' + sector._id)
      .expect(302)
      .expect('location', '/sectors');
    expect(await app.models.Sector.findById(sector._id)).toBeNull();
  });
});
