/**
 * Signup / login / logout behavior as currently implemented.
 *
 * Notable current behavior (verified, not "fixed"):
 *  - Signup only works for e-mails whitelisted in the ValidatedUser
 *    collection; others get the "email-error" page (HTTP 200).
 *  - A freshly signed-up user cannot log in until the e-mail verification
 *    authToken has been consumed via GET /verify.
 *  - Failed logins redirect back to /login, successful ones to /home.
 *  - GET /home is NOT protected by isLoggedIn (anyone can open it).
 *  - POST /changepass always responds 500 (the handler references an
 *    undefined `user` variable), so password change is effectively broken.
 */
const { bootApp, signupVerifiedUser } = require('./helpers/boot');

let app;

beforeAll(async () => {
  app = await bootApp();
});

afterAll(async () => {
  await app.close();
});

describe('signup', () => {
  test('GET /signup renders the signup form', async () => {
    const res = await app.anon().get('/signup').expect(200);
    expect(res.text).toContain('name="email"');
    expect(res.text).toContain('name="password"');
  });

  test('rejects an e-mail that is not in the ValidatedUser whitelist (renders email-error, 200)', async () => {
    const res = await app
      .anon()
      .post('/signup')
      .type('form')
      .send({ name: 'Someone', email: 'not-whitelisted@example.com', password: 'pw123456' })
      .expect(200);
    // renders views/email-error.ejs instead of creating a user
    const user = await app.models.User.findOne({ email: 'not-whitelisted@example.com' });
    expect(user).toBeNull();
    expect(res.text).not.toContain('name="password"'); // not the signup form again
  });

  test('creates an unverified user for a whitelisted e-mail and redirects to /email-verification', async () => {
    await app.models.ValidatedUser.create({ name: 'Alice', email: 'alice@example.com' });
    await app
      .anon()
      .post('/signup')
      .type('form')
      .send({ name: 'Alice', email: 'alice@example.com', password: 'alicepw1' })
      .expect(302)
      .expect('location', '/email-verification');

    // hash/salt are `select: false` in passport-local-mongoose -> opt in explicitly
    const user = await app.models.User.findOne({ email: 'alice@example.com' }).select(
      '+hash +salt'
    );
    expect(user).not.toBeNull();
    expect(user.isAuthenticated).toBe(false); // e-mail not verified yet
    expect(typeof user.authToken).toBe('string');
    expect(user.authToken.length).toBeGreaterThan(0);
    expect(user.hash).toBeDefined();
    expect(user.salt).toBeDefined();
  });

  test('signing up the same e-mail twice re-renders the signup form (200)', async () => {
    const res = await app
      .anon()
      .post('/signup')
      .type('form')
      .send({ name: 'Alice', email: 'alice@example.com', password: 'otherpw1' })
      .expect(200);
    expect(res.text).toContain('name="password"'); // signup form again
    expect(await app.models.User.countDocuments({ email: 'alice@example.com' })).toBe(1);
  });
});

describe('login / verification', () => {
  test('login is refused (redirect back to /login) before e-mail verification', async () => {
    await app.models.ValidatedUser.create({ name: 'Bob', email: 'bob@example.com' });
    await app
      .anon()
      .post('/signup')
      .type('form')
      .send({ name: 'Bob', email: 'bob@example.com', password: 'bobpw123' })
      .expect(302);

    await app
      .anon()
      .post('/login')
      .type('form')
      .send({ email: 'bob@example.com', password: 'bobpw123' })
      .expect(302)
      .expect('location', '/login');
  });

  test('GET /verify with the authToken marks the user verified', async () => {
    const bob = await app.models.User.findOne({ email: 'bob@example.com' });
    await app.anon().get('/verify').query({ authToken: bob.authToken }).expect(200);
    const verified = await app.models.User.findOne({ email: 'bob@example.com' });
    expect(verified.isAuthenticated).toBe(true);
  });

  test('login succeeds after verification and establishes a session', async () => {
    const agent = app.agent();
    await agent
      .post('/login')
      .type('form')
      .send({ email: 'bob@example.com', password: 'bobpw123' })
      .expect(302)
      .expect('location', '/home');

    // a protected page is now reachable
    await agent.get('/devices').expect(200);
  });

  test('login with a wrong password redirects back to /login', async () => {
    await app
      .anon()
      .post('/login')
      .type('form')
      .send({ email: 'bob@example.com', password: 'WRONG' })
      .expect(302)
      .expect('location', '/login');
  });

  test('login with an unknown e-mail redirects back to /login', async () => {
    await app
      .anon()
      .post('/login')
      .type('form')
      .send({ email: 'ghost@example.com', password: 'whatever' })
      .expect(302)
      .expect('location', '/login');
  });

  test('GET /login renders the login form', async () => {
    const res = await app.anon().get('/login').expect(200);
    expect(res.text).toContain('name="email"');
  });
});

describe('logout', () => {
  test('GET /logout destroys the session and redirects to /login', async () => {
    const user = await signupVerifiedUser(app, {
      name: 'Carol',
      email: 'carol@example.com',
      password: 'carolpw1',
    });
    expect(user.isAuthenticated).toBe(true);

    const agent = app.agent();
    await agent
      .post('/login')
      .type('form')
      .send({ email: 'carol@example.com', password: 'carolpw1' })
      .expect(302)
      .expect('location', '/home');
    await agent.get('/devices').expect(200);

    await agent.get('/logout').expect(302).expect('location', '/login');

    // the same cookie jar is no longer authenticated
    await agent.get('/devices').expect(302).expect('location', '/login');
  });
});

describe('misc auth-adjacent routes (current behavior)', () => {
  test('GET / (landing) and GET /home are publicly accessible', async () => {
    await app.anon().get('/').expect(200);
    // NOTE: /home is not guarded by isLoggedIn even though it is the
    // post-login landing page.
    await app.anon().get('/home').expect(200);
  });

  test('GET /getenv leaks IP/PORT configuration as JSON (no auth required)', async () => {
    const res = await app.anon().get('/getenv').expect(200);
    expect(res.body).toEqual({ ip: '127.0.0.1', port: String(app.server.address().port) });
  });

  test('GET /changepass renders, but POST /changepass always fails with 500', async () => {
    await app.anon().get('/changepass').expect(200);

    // mismatching passwords: handler throws synchronously -> 500
    await app
      .anon()
      .post('/changepass')
      .type('form')
      .send({ email: 'bob@example.com', newpass: 'a', newpassconfirm: 'b' })
      .expect(500);

    // NOTE (not asserted here because it additionally raises an
    // uncaughtException in the background, which jest reports as a test
    // error): POSTing *matching* passwords also responds 500, because the
    // handler references an undefined `user` variable (`user.save(...)`),
    // and the User.findOne callback later crashes the process with a
    // second ReferenceError (`foundUser.email = user`). Password change is
    // completely broken; the app only survives in production because of a
    // process-level `uncaughtException` swallow in application.js.
  });
});
