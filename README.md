# network-inventory

Node.js/Express + Mongoose + Passport + EJS tool that discovers network
devices over SNMP, stores devices/interfaces/POPs/links and exports
"enrichment" data.

- Runtime: Node.js 24 (LTS) - see `.nvmrc`; Express 5, Mongoose 9.
- Configuration via environment (or `.env`): `SESSION_SECRET`, `IP`, `PORT`, `DEV_DB`
  (database name on `mongodb://localhost`), optional `SEED=true`, `OS=WIN`.
- `npm start` runs the server, `npm test` runs the jest/supertest suite
  against an in-memory MongoDB.
- Running tests without downloading MongoDB binaries requires a JDK 17 or newer
  (`java` and `javac`). If MongoDB downloads are accessible, set
  `MONGOMS_USE_DOWNLOAD=1` before running `npm test` (in PowerShell:
  `$env:MONGOMS_USE_DOWNLOAD = '1'; npm test`) to skip the local shim.
