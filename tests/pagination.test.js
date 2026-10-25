/**
 * Server-side pagination endpoints for bootstrap-table:
 * GET /devices/pagination, /interfaces/pagination, /pops/pagination
 * (?limit&offset&search&sort&order -> { total, rows }) and the admin account.
 */
const { bootApp, adminAgent, ADMIN } = require('./helpers/boot');
const pagination = require('../services/pagination');

let app;
let agent;

beforeAll(async () => {
  app = await bootApp();
  agent = await adminAgent(app);
  const { Device, Interface, POP } = app.models;
  const author = { id: new app.mongoose.Types.ObjectId(), email: 'seed@example.com' };
  const devices = [];
  for (let i = 1; i <= 12; i++) {
    devices.push({
      hostname: `router-${String(i).padStart(2, '0')}`,
      ipaddress: `10.0.0.${i}`,
      pop: i % 2 ? 'DUB' : 'COR',
      popName: { name: i % 2 ? 'Dublin POP' : 'Cork POP' },
      sector: { name: i % 3 ? 'North' : 'South' },
      cty: i % 2 ? 'Dublin' : 'Cork',
      type: i <= 6 ? 'Router' : 'Switch',
      model: `MX${i}`,
      vendor: i % 4 ? 'Juniper' : 'Cisco',
      author,
      interfaces: [{ name: 'ge-0/0/0', index: 1 }],
    });
  }
  await Device.insertMany(devices);
  await Interface.insertMany([
    {
      name: 'ge-0/0/0',
      index: 1,
      alias: 'Uplink to core',
      device: { hostname: 'router-01', ipaddress: '10.0.0.1' },
    },
    {
      name: 'xe-1/0/0',
      index: 2,
      alias: 'INT-IPT-TINET',
      device: { hostname: 'router-02', ipaddress: '10.0.0.2' },
    },
    {
      name: 'ge-0/0/1',
      index: 3,
      alias: 'customer',
      device: { hostname: 'router-03', ipaddress: '10.0.0.3' },
      secondHost: 'router-09',
    },
  ]);
  await POP.insertMany([
    {
      name: 'Dublin POP',
      shortName: 'DUB',
      district: 'Downtown',
      cty: 'DUB',
      sector: 'North',
    },
    {
      name: 'Cork POP',
      shortName: 'COR',
      district: 'Smouha',
      cty: 'COR',
      sector: 'North',
    },
    {
      name: 'Galway (West) POP',
      shortName: 'GAL',
      district: 'Dokki',
      cty: 'GAL',
      sector: 'South',
    },
  ]);
});

afterAll(async () => {
  await app.close();
});

describe('admin account', () => {
  test('is created at startup, verified, with role admin, and can log in', async () => {
    const user = await app.models.User.findOne({ email: ADMIN.email });
    expect(user).not.toBeNull();
    expect(user.role).toBe('admin');
    expect(user.isAuthenticated).toBe(true);
    await agent.get('/devices').expect(200); // the agent logged in with ADMIN credentials
    expect(await app.models.ValidatedUser.countDocuments({ email: ADMIN.email })).toBe(1);
  });
});

describe('pagination endpoints are guarded', () => {
  test.each(['/devices/pagination', '/interfaces/pagination', '/pops/pagination'])(
    'GET %s anonymous -> 302 /login',
    async (url) => {
      await app.anon().get(url).expect(302).expect('location', '/login');
    }
  );
});

describe('GET /devices/pagination', () => {
  test('returns {total, rows} with the default page size and flat projected rows', async () => {
    const res = await agent.get('/devices/pagination').expect(200).expect('content-type', /json/);
    expect(res.body.total).toBe(12);
    expect(res.body.rows).toHaveLength(pagination.DEFAULT_LIMIT);
    const row = res.body.rows[0];
    expect(row.hostname).toBe('router-01'); // default sort: hostname asc
    expect(row).toMatchObject({
      popName: 'Dublin POP',
      sectorName: 'North',
      createdBy: 'seed@example.com',
    });
    expect(row.county).toBeUndefined(); // JSON drops undefined values
    expect(row.interfaces).toBeUndefined(); // not projected
    expect(row.author).toBeUndefined(); // flattened into createdBy
    expect(typeof row._id).toBe('string');
  });

  test('limit/offset page through the result set, limit is capped at 500', async () => {
    const page2 = await agent.get('/devices/pagination').query({ limit: 5, offset: 5 }).expect(200);
    expect(page2.body.total).toBe(12);
    expect(page2.body.rows.map((r) => r.hostname)).toEqual([
      'router-06',
      'router-07',
      'router-08',
      'router-09',
      'router-10',
    ]);

    const last = await agent.get('/devices/pagination').query({ limit: 5, offset: 10 }).expect(200);
    expect(last.body.rows).toHaveLength(2);

    const capped = await agent.get('/devices/pagination').query({ limit: 100000 }).expect(200);
    expect(capped.body.rows).toHaveLength(12); // all, but the limit sent to MongoDB was 500
    expect(
      pagination.parseQuery({ limit: '100000' }, { sortable: { a: 'a' }, defaultSort: 'a' }).limit
    ).toBe(500);

    const junk = await agent
      .get('/devices/pagination')
      .query({ limit: 'abc', offset: '-3' })
      .expect(200);
    expect(junk.body.rows).toHaveLength(pagination.DEFAULT_LIMIT);
  });

  test('search is case-insensitive and spans hostname/ip/pop/sector/cty/type/model/vendor', async () => {
    const byHost = await agent.get('/devices/pagination').query({ search: 'ROUTER-1' }).expect(200);
    expect(byHost.body.total).toBe(3); // router-10, 11, 12
    const byIp = await agent.get('/devices/pagination').query({ search: '10.0.0.1' }).expect(200);
    expect(byIp.body.rows.map((r) => r.ipaddress).sort()).toEqual([
      '10.0.0.1',
      '10.0.0.10',
      '10.0.0.11',
      '10.0.0.12',
    ]);
    const byVendor = await agent.get('/devices/pagination').query({ search: 'cisco' }).expect(200);
    expect(byVendor.body.total).toBe(3);
    const bySector = await agent.get('/devices/pagination').query({ search: 'south' }).expect(200);
    expect(bySector.body.total).toBe(4);
    const byPopCode = await agent.get('/devices/pagination').query({ search: 'wik' }).expect(200);
    expect(byPopCode.body.total).toBe(6);
    const byType = await agent.get('/devices/pagination').query({ search: 'switch' }).expect(200);
    expect(byType.body.total).toBe(6);
    const none = await agent
      .get('/devices/pagination')
      .query({ search: 'nothing-matches' })
      .expect(200);
    expect(none.body).toEqual({ total: 0, rows: [] });
  });

  test('regex metacharacters in the search are escaped', async () => {
    // "10.0.0.1" with an unescaped "." would also match "10x0y0z1"; ".*" would match everything
    const all = await agent.get('/devices/pagination').query({ search: '.*' }).expect(200);
    expect(all.body.total).toBe(0);
    const paren = await agent.get('/devices/pagination').query({ search: '(' }).expect(200);
    expect(paren.body.total).toBe(0);
    expect(pagination.escapeRegExp('a.b*c(d)[e]{f}|g?^$\\')).toBe(
      'a\\.b\\*c\\(d\\)\\[e\\]\\{f\\}\\|g\\?\\^\\$\\\\'
    );
  });

  test('sort/order use a whitelist of fields', async () => {
    const desc = await agent
      .get('/devices/pagination')
      .query({ sort: 'hostname', order: 'desc', limit: 3 })
      .expect(200);
    expect(desc.body.rows.map((r) => r.hostname)).toEqual(['router-12', 'router-11', 'router-10']);
    const byVendor = await agent
      .get('/devices/pagination')
      .query({ sort: 'vendor', order: 'asc', limit: 3 })
      .expect(200);
    expect(byVendor.body.rows.every((r) => r.vendor === 'Cisco')).toBe(true);
    // unknown sort field -> default sort, no error
    const unknown = await agent
      .get('/devices/pagination')
      .query({ sort: '__proto__', order: 'asc', limit: 1 })
      .expect(200);
    expect(unknown.body.rows[0].hostname).toBe('router-01');
  });
});

describe('GET /interfaces/pagination', () => {
  test('searches name/alias/device hostname/ip/second host and returns flat rows', async () => {
    const all = await agent.get('/interfaces/pagination').expect(200);
    expect(all.body.total).toBe(3);
    expect(all.body.rows[0]).toMatchObject({ ifName: 'ge-0/0/0', hostname: 'router-01' }); // default sort: device hostname
    expect(all.body.rows[0].author).toBeUndefined();

    const byAlias = await agent
      .get('/interfaces/pagination')
      .query({ search: 'int-ipt' })
      .expect(200);
    expect(byAlias.body.rows.map((r) => r.ifName)).toEqual(['xe-1/0/0']);
    const byDevice = await agent
      .get('/interfaces/pagination')
      .query({ search: 'router-03' })
      .expect(200);
    expect(byDevice.body.rows.map((r) => r.ifName)).toEqual(['ge-0/0/1']);
    const bySecondHost = await agent
      .get('/interfaces/pagination')
      .query({ search: 'router-09' })
      .expect(200);
    expect(bySecondHost.body.total).toBe(1);
    const byIp = await agent
      .get('/interfaces/pagination')
      .query({ search: '10.0.0.2' })
      .expect(200);
    expect(byIp.body.total).toBe(1);
    const sorted = await agent
      .get('/interfaces/pagination')
      .query({ sort: 'ifIndex', order: 'desc', limit: 1 })
      .expect(200);
    expect(sorted.body.rows[0].ifIndex).toBe(3);
    // unknown sort field -> default sort field (hostname), the requested order is kept
    const fallback = await agent
      .get('/interfaces/pagination')
      .query({ sort: 'index', order: 'desc', limit: 1 })
      .expect(200);
    expect(fallback.body.rows[0].hostname).toBe('router-03');
  });
});

describe('GET /pops/pagination', () => {
  test('searches name/acronym/district/county/sector, escapes input, returns flat rows', async () => {
    const all = await agent.get('/pops/pagination').expect(200);
    expect(all.body.total).toBe(3);
    expect(all.body.rows[0]).toMatchObject({
      name: 'Cork POP',
      acronym: 'COR',
      county: 'COR',
      district: 'Smouha',
      sector: 'North',
    });
    const byDistrict = await agent.get('/pops/pagination').query({ search: 'dokki' }).expect(200);
    expect(byDistrict.body.rows.map((r) => r.name)).toEqual(['Galway (West) POP']);
    const byParen = await agent.get('/pops/pagination').query({ search: '(West)' }).expect(200);
    expect(byParen.body.total).toBe(1);
    const bySector = await agent
      .get('/pops/pagination')
      .query({ search: 'north', sort: 'name', order: 'desc' })
      .expect(200);
    expect(bySector.body.rows.map((r) => r.name)).toEqual(['Dublin POP', 'Cork POP']);
  });
});
