/**
 * Dataset registry: one spec per exportable / paginatable collection.
 *
 *   Model         mongoose model
 *   searchFields  fields the free-text `search` applies to
 *   filterable    criteria accepted as filter[<name>] (services/filters.js)
 *   sortable      client sort field -> database path
 *   defaultSort   client sort field used when none is requested
 *   projection    fields fetched (lean)
 *   mapRow        lean document -> flat row (pagination rows / export rows)
 *   columns       export columns in order ([key, header]); defaults to mapRow keys
 *
 * The same spec drives GET /<resource>/pagination, the exports
 * (services/exporter.js) and the external API, so every criterion behaves
 * identically everywhere.
 */
const Device = require('../models/device');
const Interface = require('../models/interface');
const POP = require('../models/pop');
const Cabinet = require('../models/cabinet');
const DeviceModel = require('../models/devicemodel');
const BTMSANInfo = require('../models/btmsaninfo');
const Link = require('../models/link');
const AuditLog = require('../models/auditlog');
const Sector = require('../models/sector');
const County = require('../models/county');
const User = require('../models/user');
const ValidatedUser = require('../models/validatedUser');
const Enrichment = require('../models/enrichment');

const CATALOG_NAMES = Interface.fieldCatalog.map((entry) => entry.name);
const devices = {
  Model: Device,
  // decommissioned devices are not part of the active inventory
  baseFilter: Device.activeFilter(),
  filterable: {
    hostname: 'hostname',
    ipaddress: 'ipaddress',
    community: 'community',
    type: 'type',
    model: 'model',
    vendor: 'vendor',
    pop: 'pop',
    popName: 'popName.name',
    sectorName: 'sector.name',
    county: 'county.name',
    cty: 'cty',
    district: 'district',
    popType: 'popType',
    popLongName: 'popLongName',
    cabinet: 'cabinet',
    btMSANCode: 'btMSANCode',
    btSector: 'btSector',
    btDistrict: 'btDistrict',
    sysName: 'sysName',
    sysObjectID: 'sysObjectID',
    discovered: { path: 'discovered', type: 'boolean' },
    deviceSyncCycles: { path: 'deviceSyncCycles', type: 'number' },
    lastSyncTime: { path: 'lastSyncTime', type: 'date' },
    createdAt: { path: 'createdAt', type: 'date' },
    updatedAt: { path: 'updatedAt', type: 'date' },
    snmpSlow: { path: 'snmpSlow', type: 'boolean' },
    snmpTimeouts: { path: 'snmpTimeouts', type: 'number' },
    lastSyncError: 'lastSyncError',
    description: 'description',
  },
  searchFields: [
    'hostname',
    'ipaddress',
    'pop',
    'popName.name',
    'sector.name',
    'cty',
    'county.name',
    'type',
    'model',
    'vendor',
  ],
  sortable: {
    hostname: 'hostname',
    ipaddress: 'ipaddress',
    community: 'community',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    popName: 'popName.name',
    sectorName: 'sector.name',
    county: 'county.name',
    type: 'type',
    model: 'model',
    vendor: 'vendor',
    defaultCollector: 'defaultCollector',
    pop: 'pop',
    popLongName: 'popLongName',
    popType: 'popType',
    cty: 'cty',
    district: 'district',
    lastSyncTime: 'lastSyncTime',
  },
  defaultSort: 'hostname',
  // only what views/devices/index.ejs displays
  projection: {
    hostname: 1,
    ipaddress: 1,
    community: 1,
    createdAt: 1,
    updatedAt: 1,
    description: 1,
    'popName.name': 1,
    'sector.name': 1,
    'county.name': 1,
    type: 1,
    model: 1,
    vendor: 1,
    defaultCollector: 1,
    'author.email': 1,
    'lastUpdatedBy.email': 1,
    pop: 1,
    popLongName: 1,
    popType: 1,
    cabinet: 1,
    cty: 1,
    district: 1,
    btMSANCode: 1,
    btMngIP: 1,
    btSector: 1,
    btDistrict: 1,
    sysName: 1,
    lastSyncTime: 1,
    deviceSyncCycles: 1,
    snmpSlow: 1,
    snmpTimeouts: 1,
    lastSyncError: 1,
  },
  // flat rows: bootstrap-table 1.8 cannot read nested fields
  mapRow: function (device) {
    return {
      _id: String(device._id),
      hostname: device.hostname,
      ipaddress: device.ipaddress,
      community: device.community,
      createdAt: device.createdAt,
      updatedAt: device.updatedAt,
      description: device.description,
      popName: device.popName && device.popName.name,
      sectorName: device.sector && device.sector.name,
      county: device.county && device.county.name,
      type: device.type,
      model: device.model,
      vendor: device.vendor,
      defaultCollector: device.defaultCollector,
      createdBy: device.author && device.author.email,
      updatedBy: device.lastUpdatedBy && device.lastUpdatedBy.email,
      pop: device.pop,
      popLongName: device.popLongName,
      popType: device.popType,
      cabinet: device.cabinet,
      cty: device.cty,
      district: device.district,
      btMSANCode: device.btMSANCode,
      btMngIP: device.btMngIP,
      btSector: device.btSector,
      btDistrict: device.btDistrict,
      sysName: device.sysName,
      lastSyncTime: device.lastSyncTime,
      deviceSyncCycles: device.deviceSyncCycles,
      snmpSlow: Boolean(device.snmpSlow),
      snmpTimeouts: device.snmpTimeouts || 0,
      lastSyncError: device.lastSyncError,
    };
  },
};

/** the decommissioned devices (GET /devices/decommissioned) */
const decommissionedDevices = {
  ...devices,
  baseFilter: { decommissioned: true },
  filterable: {
    ...devices.filterable,
    decommissionedAt: { path: 'decommissionedAt', type: 'date' },
    decommissionedBy: 'decommissionedBy.email',
    decommissionReason: 'decommissionReason',
  },
  sortable: { ...devices.sortable, decommissionedAt: 'decommissionedAt' },
  defaultSort: 'decommissionedAt',
  projection: {
    ...devices.projection,
    decommissionedAt: 1,
    'decommissionedBy.email': 1,
    decommissionReason: 1,
  },
  mapRow: function (device) {
    return Object.assign(devices.mapRow(device), {
      decommissionedAt: device.decommissionedAt,
      decommissionedBy: device.decommissionedBy && device.decommissionedBy.email,
      decommissionReason: device.decommissionReason,
    });
  },
};

/** audit trail (GET /audit) */
const auditlogs = {
  Model: AuditLog,
  filterable: {
    action: 'action',
    user: 'user.email',
    targetType: 'target.type',
    targetId: 'target.id',
    target: 'target.label',
    at: { path: 'at', type: 'date' },
  },
  searchFields: ['action', 'user.email', 'target.type', 'target.label', 'target.id'],
  sortable: { at: 'at', action: 'action', user: 'user.email', target: 'target.label' },
  defaultSort: 'at',
  projection: { action: 1, at: 1, 'user.email': 1, target: 1, ip: 1, 'details.reason': 1 },
  mapRow: function (entry) {
    return {
      _id: String(entry._id),
      at: entry.at,
      action: entry.action,
      user: entry.user && entry.user.email,
      targetType: entry.target && entry.target.type,
      targetId: entry.target && entry.target.id,
      target: entry.target && entry.target.label,
      reason: entry.details && entry.details.reason,
      ip: entry.ip,
    };
  },
};

const interfaces = {
  Model: Interface,
  // every catalog field is a criterion, typed after its kind
  filterable: Object.fromEntries(
    Interface.fieldCatalog
      .filter((entry) => entry.kind !== 'json')
      .map((entry) => [
        entry.name,
        {
          path: entry.name,
          type:
            entry.kind === 'number'
              ? 'number'
              : entry.kind === 'boolean'
                ? 'boolean'
                : entry.kind === 'date'
                  ? 'date'
                  : 'text',
        },
      ])
  ),
  searchFields: [
    'ifName',
    'ifAlias',
    'ifDescr',
    'ifTypeStr',
    'hostname',
    'ipaddress',
    'pop',
    'type',
    'specialService',
    'secondHost',
    'secondPOP',
    'secondInterface',
    'label',
    'connectionType',
    'linkType',
    'speedCat',
    'sp_provider',
    'sp_customer',
    'sp_service',
    'sp_linkNumber',
    'sp_CID',
  ],
  sortable: Object.fromEntries(CATALOG_NAMES.map((name) => [name, name])),
  defaultSort: 'hostname',
  // every catalog field plus the legacy names the list still shows
  projection: Object.fromEntries(
    [
      ...CATALOG_NAMES,
      'name',
      'alias',
      'index',
      'description',
      'author.email',
      'lastUpdatedBy.email',
      'created',
      'updated',
      'device.hostname',
      'device.ipaddress',
    ].map((name) => [name, 1])
  ),
  mapRow: function (intf) {
    const row = { _id: String(intf._id) };
    for (const name of CATALOG_NAMES) {
      row[name] = name === 'counters' ? JSON.stringify(intf.counters || {}) : intf[name];
    }
    // legacy fallbacks for documents created before the canonical names existed
    row.ifName = row.ifName || intf.name;
    row.ifAlias = row.ifAlias || intf.alias;
    row.ifIndex = row.ifIndex === undefined || row.ifIndex === null ? intf.index : row.ifIndex;
    row.ifDescr = row.ifDescr || intf.description;
    row.hostname = row.hostname || (intf.device && intf.device.hostname);
    row.ipaddress = row.ipaddress || (intf.device && intf.device.ipaddress);
    row.createdAt = row.createdAt || intf.created;
    row.lastUpdate = row.lastUpdate || intf.updated;
    row.createdBy = intf.author && intf.author.email;
    row.updatedBy = intf.lastUpdatedBy && intf.lastUpdatedBy.email;
    return row;
  },
};

const pops = {
  Model: POP,
  filterable: {
    name: 'name',
    shortName: 'shortName',
    acronym: 'shortName',
    cty: 'cty',
    district: 'district',
    sector: 'sector',
    popType: 'popType',
    popLongName: 'popLongName',
    pop_cty: 'pop_cty',
    parentPOP: 'parentPOP',
  },
  searchFields: [
    'name',
    'shortName',
    'cty',
    'district',
    'sector',
    'popType',
    'popLongName',
    'pop_cty',
    'countyAcro.acronym',
  ],
  sortable: {
    name: 'name',
    acronym: 'shortName',
    county: 'cty',
    cty: 'cty',
    district: 'district',
    sector: 'sector',
    popType: 'popType',
    popLongName: 'popLongName',
    pop_cty: 'pop_cty',
  },
  defaultSort: 'name',
  // only what views/pops/index.ejs displays
  projection: {
    name: 1,
    shortName: 1,
    'countyAcro.acronym': 1,
    cty: 1,
    district: 1,
    sector: 1,
    popType: 1,
    popLongName: 1,
    pop_cty: 1,
  },
  mapRow: function (pop) {
    // documents written before the flat fields existed may still carry the old {id, name} sector
    const sector = pop.sector && typeof pop.sector === 'object' ? pop.sector.name : pop.sector;
    const cty =
      pop.cty && pop.cty !== POP.UNKNOWN ? pop.cty : pop.countyAcro && pop.countyAcro.acronym;
    return {
      _id: String(pop._id),
      id: String(pop._id), // select2 option id
      name: pop.name,
      acronym: pop.shortName,
      county: cty || POP.UNKNOWN,
      cty: cty || POP.UNKNOWN,
      district: pop.district,
      sector: sector || POP.UNKNOWN,
      popType: pop.popType,
      popLongName: pop.popLongName,
      pop_cty: pop.pop_cty,
    };
  },
};

const cabinets = {
  Model: Cabinet,
  filterable: {
    cabinet: 'cabinet',
    pop: 'pop',
    location: 'location',
    createdAt: { path: 'createdAt', type: 'date' },
  },
  searchFields: ['cabinet', 'pop', 'location', 'locNotes'],
  sortable: { cabinet: 'cabinet', pop: 'pop', location: 'location', createdAt: 'createdAt' },
  defaultSort: 'cabinet',
  projection: { cabinet: 1, pop: 1, location: 1, locNotes: 1, createdAt: 1, 'author.email': 1 },
  mapRow: function (cabinet) {
    return {
      _id: String(cabinet._id),
      cabinet: cabinet.cabinet,
      pop: cabinet.pop,
      location: cabinet.location,
      locNotes: cabinet.locNotes,
      createdAt: cabinet.createdAt,
      createdBy: cabinet.author && cabinet.author.email,
    };
  },
};

const devicemodels = {
  Model: DeviceModel,
  filterable: { name: 'name', vendor: 'vendor', type: 'type', sysObjectIDs: 'sysObjectIDs' },
  searchFields: ['name', 'vendor', 'type', 'sysObjectIDs', 'notes'],
  sortable: { name: 'name', vendor: 'vendor', type: 'type', createdAt: 'createdAt' },
  defaultSort: 'name',
  projection: {
    name: 1,
    vendor: 1,
    type: 1,
    sysObjectIDs: 1,
    notes: 1,
    createdAt: 1,
    'author.email': 1,
  },
  mapRow: function (model) {
    return {
      _id: String(model._id),
      name: model.name,
      vendor: model.vendor,
      type: model.type,
      sysObjectIDs: (model.sysObjectIDs || []).join(', '),
      notes: model.notes,
      createdAt: model.createdAt,
      createdBy: model.author && model.author.email,
    };
  },
};

const btmsaninfos = {
  Model: BTMSANInfo,
  filterable: { msanCode: 'msanCode', mngIP: 'mngIP', sector: 'sector', district: 'district' },
  searchFields: ['msanCode', 'mngIP', 'sector', 'district', 'notes'],
  sortable: {
    msanCode: 'msanCode',
    mngIP: 'mngIP',
    sector: 'sector',
    district: 'district',
    createdAt: 'createdAt',
  },
  defaultSort: 'msanCode',
  projection: {
    msanCode: 1,
    mngIP: 1,
    sector: 1,
    district: 1,
    notes: 1,
    createdAt: 1,
    'author.email': 1,
  },
  mapRow: function (info) {
    return {
      _id: String(info._id),
      msanCode: info.msanCode,
      mngIP: info.mngIP,
      sector: info.sector,
      district: info.district,
      notes: info.notes,
      createdAt: info.createdAt,
      createdBy: info.author && info.author.email,
    };
  },
};

const links = {
  Model: Link,
  searchFields: [
    'device1',
    'interface1',
    'device2',
    'interface2',
    'type',
    'specialService',
    'pop1',
    'pop2',
    'label',
  ],
  filterable: {
    device1: 'device1',
    device2: 'device2',
    interface1: 'interface1',
    interface2: 'interface2',
    type: 'type',
    specialService: 'specialService',
    pop1: 'pop1',
    pop2: 'pop2',
    createdAt: { path: 'createdAt', type: 'date' },
  },
  sortable: { device1: 'device1', device2: 'device2', type: 'type', createdAt: 'createdAt' },
  defaultSort: 'device1',
  projection: {
    device1: 1,
    interface1: 1,
    device2: 1,
    interface2: 1,
    type: 1,
    specialService: 1,
    pop1: 1,
    pop2: 1,
    label: 1,
    speed: 1,
    createdAt: 1,
    'author.email': 1,
  },
  mapRow: function (link) {
    return {
      _id: String(link._id),
      device1: link.device1,
      interface1: link.interface1,
      device2: link.device2,
      interface2: link.interface2,
      type: link.type,
      specialService: link.specialService,
      pop1: link.pop1,
      pop2: link.pop2,
      label: link.label,
      speed: link.speed,
      createdAt: link.createdAt,
      createdBy: link.author && link.author.email,
    };
  },
};

const sectors = {
  Model: Sector,
  filterable: { name: 'name', description: 'description' },
  searchFields: ['name', 'description'],
  sortable: { name: 'name', description: 'description' },
  defaultSort: 'name',
  projection: { name: 1, description: 1, 'author.email': 1 },
  mapRow: function (sector) {
    return {
      _id: String(sector._id),
      id: String(sector._id), // select2 option id
      name: sector.name,
      description: sector.description,
      createdBy: sector.author && sector.author.email,
    };
  },
};

const counties = {
  Model: County,
  filterable: { name: 'name', acronym: 'acronym' },
  searchFields: ['name', 'acronym'],
  sortable: { name: 'name', acronym: 'acronym' },
  defaultSort: 'name',
  projection: { name: 1, acronym: 1, 'author.email': 1 },
  mapRow: function (cty) {
    return {
      _id: String(cty._id),
      id: String(cty._id), // select2 option id
      name: cty.name,
      acronym: cty.acronym,
      createdBy: cty.author && cty.author.email,
    };
  },
};

const users = {
  Model: User,
  filterable: {
    name: 'name',
    email: 'email',
    role: 'role',
    isAuthenticated: { path: 'isAuthenticated', type: 'boolean' },
  },
  searchFields: ['name', 'email', 'role'],
  sortable: { name: 'name', email: 'email', role: 'role', isAuthenticated: 'isAuthenticated' },
  defaultSort: 'email',
  projection: { name: 1, email: 1, role: 1, isAuthenticated: 1 },
  mapRow: function (user) {
    return {
      _id: String(user._id),
      name: user.name,
      email: user.email,
      role: user.role,
      isAuthenticated: Boolean(user.isAuthenticated),
    };
  },
};

const validatedusers = {
  Model: ValidatedUser,
  filterable: { name: 'name', email: 'email', role: 'role' },
  searchFields: ['name', 'email', 'role'],
  sortable: { name: 'name', email: 'email', role: 'role' },
  defaultSort: 'email',
  projection: { name: 1, email: 1, role: 1, 'author.email': 1 },
  mapRow: function (user) {
    return {
      _id: String(user._id),
      name: user.name,
      email: user.email,
      role: user.role,
      createdBy: user.author && user.author.email,
    };
  },
};

// legacy B_TED enrichment rows: every schema column, typed after the schema
const ENRICHMENT_FIELDS = Object.keys(Enrichment.schema.paths).filter(
  (name) => !['_id', '__v'].includes(name)
);
const enrichments = {
  Model: Enrichment,
  filterable: Object.fromEntries(
    ENRICHMENT_FIELDS.map((name) => [
      name,
      { path: name, type: Enrichment.schema.paths[name].instance === 'Number' ? 'number' : 'text' },
    ])
  ),
  searchFields: ENRICHMENT_FIELDS.filter(
    (name) => Enrichment.schema.paths[name].instance === 'String'
  ),
  sortable: Object.fromEntries(ENRICHMENT_FIELDS.map((name) => [name, name])),
  defaultSort: 'SE_Name',
  projection: Object.fromEntries(ENRICHMENT_FIELDS.map((name) => [name, 1])),
  mapRow: function (row) {
    const out = { _id: String(row._id) };
    for (const name of ENRICHMENT_FIELDS) out[name] = row[name];
    return out;
  },
  fields: ENRICHMENT_FIELDS,
};

const all = {
  devices,
  interfaces,
  pops,
  cabinets,
  devicemodels,
  btmsaninfos,
  links,
  decommissionedDevices,
  auditlogs,
  sectors,
  counties,
  enrichments,
};
// account lists are paginated like the others but never exported / exposed on the API
const internal = { users, validatedusers };

/** column list of a dataset ([key, header] pairs) */
function columnsOf(spec) {
  if (spec.columns) return spec.columns;
  const sample = spec.mapRow({
    _id: '',
    author: {},
    lastUpdatedBy: {},
    device: {},
    popName: {},
    sector: {},
    county: {},
    countyAcro: {},
  });
  return Object.keys(sample).map((key) => [key, key]);
}

module.exports = { ...all, ...internal, all, columnsOf };
