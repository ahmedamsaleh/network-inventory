/**
 * isLoggedIn middleware coverage.
 *
 * Routes that use middleware.isLoggedIn redirect anonymous users to /login.
 * A surprising number of mutating routes do NOT use the guard at all; that
 * current behavior is asserted at the bottom (and exercised in depth in the
 * per-resource test files).
 */
const { bootApp, authedAgent } = require('./helpers/boot');

let app;
let fakeId;

beforeAll(async () => {
  app = await bootApp();
  fakeId = String(new app.mongoose.Types.ObjectId());
});

afterAll(async () => {
  await app.close();
});

describe('guarded routes redirect anonymous users to /login', () => {
  const guardedGets = [
    '/devices',
    '/devices/new',
    '/devices/sync',
    '/interfaces',
    '/interfaces/new',
    '/pops',
    '/pops/new',
    '/pops/pagination',
    '/sectors',
    '/sectors/new',
    '/sectors/pagination',
    '/counties',
    '/counties/new',
    '/counties/pagination',
    '/links',
    '/links/new',
    '/users',
    '/validatedusers',
    '/validatedusers/new',
    '/enrichments',
    '/enrichments/new',
    '/enrichments/export',
  ];

  test.each(guardedGets)('GET %s -> 302 /login', async (url) => {
    await app.anon().get(url).expect(302).expect('location', '/login');
  });

  test('GET show/edit/sync routes with an id are guarded for devices', async () => {
    await app
      .anon()
      .get('/devices/' + fakeId)
      .expect(302)
      .expect('location', '/login');
    await app
      .anon()
      .get('/devices/' + fakeId + '/edit')
      .expect(302)
      .expect('location', '/login');
    await app
      .anon()
      .get('/devices/sync/' + fakeId)
      .expect(302)
      .expect('location', '/login');
  });

  test('GET show routes with an id are guarded for pops/sectors/counties/links/validatedusers', async () => {
    for (const base of ['/pops', '/sectors', '/counties', '/links', '/validatedusers']) {
      await app
        .anon()
        .get(base + '/' + fakeId)
        .expect(302)
        .expect('location', '/login');
    }
  });

  const guardedPosts = [
    '/devices',
    '/interfaces',
    '/pops',
    '/sectors',
    '/counties',
    '/links',
    '/validatedusers',
    '/enrichments',
  ];

  test.each(guardedPosts)('POST %s -> 302 /login', async (url) => {
    await app.anon().post(url).type('form').send({}).expect(302).expect('location', '/login');
  });

  test('PUT and DELETE on devices/:id and interfaces/:id are guarded', async () => {
    await app
      .anon()
      .put('/devices/' + fakeId)
      .type('form')
      .send({})
      .expect(302)
      .expect('location', '/login');
    await app
      .anon()
      .delete('/devices/' + fakeId)
      .expect(302)
      .expect('location', '/login');
    await app
      .anon()
      .put('/interfaces/' + fakeId)
      .type('form')
      .send({})
      .expect(302)
      .expect('location', '/login');
    await app
      .anon()
      .delete('/interfaces/' + fakeId)
      .expect(302)
      .expect('location', '/login');
    // interfaces edit form is guarded too
    await app
      .anon()
      .get('/interfaces/' + fakeId + '/edit')
      .expect(302)
      .expect('location', '/login');
  });

  test('guard also honors method-override (POST + ?_method=DELETE)', async () => {
    await app
      .anon()
      .post('/devices/' + fakeId + '?_method=DELETE')
      .type('form')
      .send({})
      .expect(302)
      .expect('location', '/login');
  });

  test('an authenticated session passes the guard', async () => {
    const { agent } = await authedAgent(app);
    await agent.get('/devices').expect(200);
    await agent.get('/pops').expect(200);
    await agent.get('/users').expect(200);
    await agent.get('/enrichments').expect(200);
  });
});

describe('routes that are NOT guarded although they mutate/expose data (current behavior)', () => {
  // These assert today's behavior so regressions (or fixes) become visible.
  // Details are exercised per-resource; here we just pin the lack of a guard.
  test('edit forms of pops/sectors/counties/links/validatedusers are public', async () => {
    const { POP, Sector, County, Link, ValidatedUser } = app.models;
    const pop = await POP.create({ name: 'GuardPop' });
    const sector = await Sector.create({ name: 'GuardSector' });
    const cty = await County.create({ name: 'GuardCty', acronym: 'GG' });
    const link = await Link.create({
      device1: 'a',
      interface1: 'i1',
      device2: 'b',
      interface2: 'i2',
    });
    const vu = await ValidatedUser.create({ name: 'VU', email: 'vu@example.com' });

    await app
      .anon()
      .get('/pops/' + pop._id + '/edit')
      .expect(200);
    await app
      .anon()
      .get('/sectors/' + sector._id + '/edit')
      .expect(200);
    await app
      .anon()
      .get('/counties/' + cty._id + '/edit')
      .expect(200);
    await app
      .anon()
      .get('/links/' + link._id + '/edit')
      .expect(200);
    await app
      .anon()
      .get('/validatedusers/' + vu._id + '/edit')
      .expect(200);
  });

  test('DELETE /users/:id works without any authentication', async () => {
    const { agent, user } = await authedAgent(app, {
      name: 'Victim',
      email: 'victim@example.com',
      password: 'victimpw1',
    });
    // anonymous client deletes the account of a logged-in user
    await app
      .anon()
      .delete('/users/' + user._id)
      .expect(302)
      .expect('location', '/users');
    expect(await app.models.User.findById(user._id)).toBeNull();
    // (the already-established session cookie of the victim keeps passing
    //  the guard until deserialization fails - not asserted here)
    void agent;
  });

  test('DELETE /validatedusers/:id works without any authentication', async () => {
    const vu = await app.models.ValidatedUser.create({ name: 'VU2', email: 'vu2@example.com' });
    await app
      .anon()
      .delete('/validatedusers/' + vu._id)
      .expect(302)
      .expect('location', '/validatedusers');
    expect(await app.models.ValidatedUser.findById(vu._id)).toBeNull();
  });
});
