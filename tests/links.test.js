/**
 * CRUD for /links.
 *
 * Current-behavior notes:
 *  - Edit form, update and delete are NOT protected by isLoggedIn.
 *  - Showing a non-existent (valid) id responds 500.
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

describe('Link CRUD (authenticated)', () => {
  let linkId;

  test('INDEX: GET /links renders the list', async () => {
    await app.models.Link.create({
      device1: 'pre-dev1',
      interface1: 'ge-0/0/9',
      device2: 'pre-dev2',
      interface2: 'ge-0/0/8',
    });
    // the list itself is loaded by bootstrap-table from /links/pagination
    const res = await agent.get('/links').expect(200);
    expect(res.text).toContain('data-url="/links/pagination"');
    const json = await agent.get('/links/pagination').expect(200);
    expect(json.body.rows.map((r) => r.device1)).toContain('pre-dev1');
  });

  test('NEW: GET /links/new renders the form', async () => {
    const res = await agent.get('/links/new').expect(200);
    expect(res.text).toContain('name="link[device1]"');
  });

  test('CREATE: POST /links stores both endpoints and the author', async () => {
    await agent
      .post('/links')
      .type('form')
      .send({
        'link[device1]': 'router-a',
        'link[interface1]': 'ge-0/0/0',
        'link[device2]': 'router-b',
        'link[interface2]': 'ge-0/0/1',
      })
      .expect(302)
      .expect('location', '/links');

    const link = await app.models.Link.findOne({ device1: 'router-a' });
    expect(link).not.toBeNull();
    linkId = String(link._id);
    expect(link.interface1).toBe('ge-0/0/0');
    expect(link.device2).toBe('router-b');
    expect(link.interface2).toBe('ge-0/0/1');
    expect(link.author.email).toBe(user.email);
  });

  test('SHOW: GET /links/:id renders the link', async () => {
    const res = await agent.get('/links/' + linkId).expect(200);
    expect(res.text).toContain('router-a');
    expect(res.text).toContain('router-b');
  });

  test('SHOW/EDIT: non-existent or malformed ids respond 404 (not-found page)', async () => {
    const missing = new app.mongoose.Types.ObjectId();
    const res = await agent.get('/links/' + missing).expect(404);
    expect(res.text).toContain('Link ');
    expect(res.text).toContain(String(missing) + '&#34; does not exist');
    await agent.get('/links/' + missing + '/edit').expect(404);
    await agent.get('/links/not-an-object-id').expect(404); // used to hang forever
    await agent.get('/links/not-an-object-id/edit').expect(404);
  });

  test('EDIT: GET /links/:id/edit renders the form', async () => {
    const res = await agent.get('/links/' + linkId + '/edit').expect(200);
    expect(res.text).toContain('router-a');
  });

  test('UPDATE: PUT /links/:id updates and redirects to show', async () => {
    await agent
      .put('/links/' + linkId)
      .type('form')
      .send({
        'link[device1]': 'router-a2',
        'link[interface1]': 'xe-0/0/0',
        'link[device2]': 'router-b2',
        'link[interface2]': 'xe-0/0/1',
      })
      .expect(302)
      .expect('location', '/links/' + linkId);
    const link = await app.models.Link.findById(linkId);
    expect(link.device1).toBe('router-a2');
    expect(link.interface1).toBe('xe-0/0/0');
  });

  test('DESTROY: DELETE /links/:id removes the link', async () => {
    await agent
      .delete('/links/' + linkId)
      .expect(302)
      .expect('location', '/links');
    expect(await app.models.Link.findById(linkId)).toBeNull();
  });
});

describe('Link routes that skip the login guard (current behavior)', () => {
  test('anonymous users can edit, update and delete links', async () => {
    const link = await app.models.Link.create({
      device1: 'anon-1',
      interface1: 'i1',
      device2: 'anon-2',
      interface2: 'i2',
    });

    await app
      .anon()
      .get('/links/' + link._id + '/edit')
      .expect(200);

    await app
      .anon()
      .put('/links/' + link._id)
      .type('form')
      .send({ 'link[device1]': 'anon-edited' })
      .expect(302)
      .expect('location', '/links/' + link._id);
    expect((await app.models.Link.findById(link._id)).device1).toBe('anon-edited');

    await app
      .anon()
      .delete('/links/' + link._id)
      .expect(302)
      .expect('location', '/links');
    expect(await app.models.Link.findById(link._id)).toBeNull();
  });
});
