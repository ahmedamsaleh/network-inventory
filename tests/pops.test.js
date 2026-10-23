/**
 * CRUD for /pops.
 *
 * Current-behavior notes (asserted below):
 *  - POST /pops stores name/shortName/district + author, but the values the
 *    new-POP form submits for `pop[governorateAcro]` and `pop[sector]` are
 *    plain strings while the schema expects nested objects, so they are
 *    silently dropped.
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
    expect(res.text).toContain('Preexisting-POP');
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
        'pop[name]=Zamalek&pop[shortName]=ZMK&pop[governorateAcro]=GZ&pop[district]=West&pop[sector]=S1'
      )
      .expect(302)
      .expect('location', '/pops');

    const pop = await app.models.POP.findOne({ name: 'Zamalek' });
    expect(pop).not.toBeNull();
    popId = String(pop._id);
    expect(pop.shortName).toBe('ZMK');
    expect(pop.district).toBe('West');
    expect(pop.author.email).toBe(user.email);
    expect(String(pop.author.id)).toBe(String(user._id));
    // ODD: the form's governorateAcro/sector strings cannot be cast to the
    // nested {id, acronym}/{id, name} schema paths and are silently lost.
    expect(pop.toObject().governorateAcro).toBeUndefined();
    expect(pop.toObject().sector).toBeUndefined();
  });

  test('SHOW: GET /pops/:id renders the pop', async () => {
    const res = await agent.get('/pops/' + popId).expect(200);
    expect(res.text).toContain('Zamalek');
  });

  test('SHOW: GET /pops/:id with a non-existent (but valid) id responds 500', async () => {
    await agent.get('/pops/' + new app.mongoose.Types.ObjectId()).expect(500);
  });

  test('EDIT: GET /pops/:id/edit renders the form', async () => {
    const res = await agent.get('/pops/' + popId + '/edit').expect(200);
    expect(res.text).toContain('Zamalek');
  });

  test('UPDATE: PUT /pops/:id updates and redirects to the show page', async () => {
    await agent
      .put('/pops/' + popId)
      .type('form')
      .send('pop[name]=Zamalek-2&pop[shortName]=ZM2&pop[district]=East')
      .expect(302)
      .expect('location', '/pops/' + popId);
    const pop = await app.models.POP.findById(popId);
    expect(pop.name).toBe('Zamalek-2');
    expect(pop.shortName).toBe('ZM2');
    expect(pop.district).toBe('East');
  });

  test('UPDATE also works through method-override (POST + ?_method=PUT)', async () => {
    await agent
      .post('/pops/' + popId + '?_method=PUT')
      .type('form')
      .send('pop[name]=Zamalek-3')
      .expect(302)
      .expect('location', '/pops/' + popId);
    expect((await app.models.POP.findById(popId)).name).toBe('Zamalek-3');
  });

  test('PAGINATION: GET /pops/pagination returns JSON with names only', async () => {
    const res = await agent.get('/pops/pagination').expect(200).expect('content-type', /json/);
    expect(res.body).toMatchObject({ limit: 5000 });
    expect(Array.isArray(res.body.docs)).toBe(true);
    const names = res.body.docs.map((d) => d.name);
    expect(names).toContain('Zamalek-3');
    expect(res.body.docs[0].shortName).toBeUndefined(); // select: 'name'
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
