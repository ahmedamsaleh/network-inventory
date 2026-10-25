/**
 * `npm start` helper (prestart): makes sure a usable .env exists for local
 * development. In production (NODE_ENV=production) nothing is generated - the
 * application keeps failing fast on a missing SESSION_SECRET.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const envFile = path.join(root, '.env');
const exampleFile = path.join(root, '.env.example');

if (process.env.NODE_ENV === 'production') {
  process.exit(0);
}

const secret = crypto.randomBytes(32).toString('hex');
const adminPassword = crypto.randomBytes(9).toString('base64url');

if (!fs.existsSync(envFile)) {
  const template = fs.readFileSync(exampleFile, 'utf8');
  fs.writeFileSync(
    envFile,
    template
      .replace(/^SESSION_SECRET=.*$/m, `SESSION_SECRET=${secret}`)
      .replace(/^ADMIN_PASSWORD=.*$/m, `ADMIN_PASSWORD=${adminPassword}`)
  );
  console.log('ensure-env: created .env from .env.example with a generated SESSION_SECRET');
  console.log(
    `ensure-env: admin account admin@example.com / ${adminPassword} (stored in .env as ADMIN_PASSWORD)`
  );
} else {
  let current = fs.readFileSync(envFile, 'utf8');
  if (!/^ADMIN_EMAIL=/m.test(current) && !/^ADMIN_PASSWORD=/m.test(current)) {
    current += `\n# Administrator account created at startup if it does not exist\nADMIN_EMAIL=admin@example.com\nADMIN_PASSWORD=${adminPassword}\n`;
    fs.writeFileSync(envFile, current);
    console.log(
      `ensure-env: added admin account admin@example.com / ${adminPassword} to .env (ADMIN_EMAIL / ADMIN_PASSWORD)`
    );
  }
  if (process.env.SESSION_SECRET) {
    process.exit(0);
  }
  if (/^SESSION_SECRET=\s*$/m.test(current)) {
    fs.writeFileSync(envFile, current.replace(/^SESSION_SECRET=\s*$/m, `SESSION_SECRET=${secret}`));
    console.log('ensure-env: filled the empty SESSION_SECRET in .env with a generated value');
  } else if (!/^SESSION_SECRET=/m.test(current)) {
    fs.appendFileSync(envFile, `\nSESSION_SECRET=${secret}\n`);
    console.log('ensure-env: added a generated SESSION_SECRET to .env');
  }
}
