/**
 * CRUD for /governorates.
 *
 * Current-behavior notes:
 *  - `name` is the only required field; creating without it flashes an error
 *    but the response is a 302 back to /governorates either way.
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

describe('Governorate CRUD (authenticated)', () => {
  let govId;

  test('INDEX: GET /governorates renders the list', async () => {
    await app.models.Governorate.create({ name: 'Preexisting-Gov', acronym: 'PG' });
    const res = await agent.get('/governorates').expect(200);
    expect(res.text).toContain('Preexisting-Gov');
  });

  test('NEW: GET /governorates/new renders the form', async () => {
    const res = await agent.get('/governorates/new').expect(200);
    expect(res.text).toContain('name="governorate[name]"');
  });

  test('CREATE: POST /governorates stores name, acronym and author', async () => {
    await agent
      .post('/governorates')
      .type('form')
      .send({ 'governorate[name]': 'Giza', 'governorate[acronym]': 'GZ' })
      .expect(302)
      .expect('location', '/governorates');

    const gov = await app.models.Governorate.findOne({ name: 'Giza' });
    expect(gov).not.toBeNull();
    govId = String(gov._id);
    expect(gov.acronym).toBe('GZ');
    expect(gov.author.email).toBe(user.email);
  });

  test('CREATE: missing required name -> document is not created and the request NEVER gets a response', async () => {
    const before = await app.models.Governorate.countDocuments({});
    // ODD: the error branch of Governorate.create only flashes a message
    // and never sends a response, so the HTTP request hangs forever.
    await expect(
      agent
        .post('/governorates')
        .type('form')
        .send({ 'governorate[acronym]': 'XX' })
        .timeout({ response: 2000 })
    ).rejects.toMatchObject({ code: 'ECONNABORTED' });
    expect(await app.models.Governorate.countDocuments({})).toBe(before);
  });

  test('SHOW: GET /governorates/:id renders the governorate', async () => {
    const res = await agent.get('/governorates/' + govId).expect(200);
    expect(res.text).toContain('Giza');
  });

  test('SHOW: non-existent (but valid) id responds 500', async () => {
    await agent.get('/governorates/' + new app.mongoose.Types.ObjectId()).expect(500);
  });

  test('EDIT: GET /governorates/:id/edit renders the form', async () => {
    const res = await agent.get('/governorates/' + govId + '/edit').expect(200);
    expect(res.text).toContain('Giza');
  });

  test('UPDATE: PUT /governorates/:id updates and redirects to show', async () => {
    await agent
      .put('/governorates/' + govId)
      .type('form')
      .send({ 'governorate[name]': 'Giza-Renamed', 'governorate[acronym]': 'GZ2' })
      .expect(302)
      .expect('location', '/governorates/' + govId);
    const gov = await app.models.Governorate.findById(govId);
    expect(gov.name).toBe('Giza-Renamed');
    expect(gov.acronym).toBe('GZ2');
  });

  test('PAGINATION: GET /governorates/pagination returns JSON (limit 500)', async () => {
    const res = await agent
      .get('/governorates/pagination')
      .expect(200)
      .expect('content-type', /json/);
    expect(res.body).toMatchObject({ limit: 500 });
    expect(res.body.docs.map((d) => d.name)).toContain('Giza-Renamed');
  });

  test('DESTROY: DELETE /governorates/:id removes the governorate', async () => {
    await agent
      .delete('/governorates/' + govId)
      .expect(302)
      .expect('location', '/governorates');
    expect(await app.models.Governorate.findById(govId)).toBeNull();
  });
});

describe('Governorate routes that skip the login guard (current behavior)', () => {
  test('anonymous users can edit, update and delete governorates', async () => {
    const gov = await app.models.Governorate.create({ name: 'Anon-Gov', acronym: 'AG' });

    await app
      .anon()
      .get('/governorates/' + gov._id + '/edit')
      .expect(200);

    await app
      .anon()
      .put('/governorates/' + gov._id)
      .type('form')
      .send({ 'governorate[name]': 'Anon-Edited' })
      .expect(302)
      .expect('location', '/governorates/' + gov._id);
    expect((await app.models.Governorate.findById(gov._id)).name).toBe('Anon-Edited');

    await app
      .anon()
      .delete('/governorates/' + gov._id)
      .expect(302)
      .expect('location', '/governorates');
    expect(await app.models.Governorate.findById(gov._id)).toBeNull();
  });
});
