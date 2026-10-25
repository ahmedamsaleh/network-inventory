/**
 * bootstrap-table column definitions shared by several list pages
 * (views/partials/data-table.ejs); available to the templates as `columns`.
 * Field names are the keys produced by services/datasets.js mapRow().
 */
const Interface = require('../models/interface');
const Enrichment = require('../models/enrichment');

const devices = [
  { field: 'hostname', title: 'Hostname', formatter: 'deviceLinkFormatter' },
  { field: 'ipaddress', title: 'IP address' },
  { field: 'type', title: 'Type' },
  { field: 'model', title: 'Model' },
  { field: 'vendor', title: 'Vendor' },
  { field: 'popName', title: 'POP' },
  { field: 'pop', title: 'POP code' },
  { field: 'popLongName', title: 'POP long name', visible: false },
  { field: 'popType', title: 'POP type', visible: false },
  { field: 'cabinet', title: 'Cabinet', formatter: 'unknownFormatter' },
  { field: 'sectorName', title: 'Sector', visible: false },
  { field: 'county', title: 'County', visible: false },
  { field: 'cty', title: 'County code', visible: false },
  { field: 'district', title: 'District', visible: false },
  { field: 'btMSANCode', title: 'BT MSAN code', visible: false },
  { field: 'btMngIP', title: 'BT mng IP', visible: false },
  { field: 'btSector', title: 'BT sector', visible: false },
  { field: 'btDistrict', title: 'BT district', visible: false },
  { field: 'community', title: 'SNMP community', visible: false },
  { field: 'description', title: 'Description', visible: false, sortable: false },
  { field: 'sysName', title: 'sysName', visible: false, sortable: false },
  { field: 'lastSyncTime', title: 'Last sync', formatter: 'dateTimeFormatter' },
  { field: 'deviceSyncCycles', title: 'Sync cycles', visible: false, sortable: false },
  {
    field: 'snmpSlow',
    title: 'SNMP slow',
    visible: false,
    sortable: false,
    formatter: 'booleanFormatter',
  },
  { field: 'snmpTimeouts', title: 'SNMP timeouts', visible: false, sortable: false },
  { field: 'lastSyncError', title: 'Last sync error', visible: false, sortable: false },
  { field: 'defaultCollector', title: 'Collector', visible: false },
  { field: 'createdAt', title: 'Created', visible: false, formatter: 'dateFormatter' },
  { field: 'createdBy', title: 'Created by', visible: false, sortable: false },
  { field: 'updatedAt', title: 'Updated', visible: false, formatter: 'dateFormatter' },
  { field: 'updatedBy', title: 'Updated by', visible: false, sortable: false },
];

const decommissionedDevices = [
  devices[0],
  devices[1],
  { field: 'decommissionedAt', title: 'Decommissioned', formatter: 'dateTimeFormatter' },
  { field: 'decommissionedBy', title: 'By', sortable: false },
  { field: 'decommissionReason', title: 'Reason', sortable: false },
  ...devices.slice(2).map((column) => ({
    ...column,
    visible: ['type', 'model', 'vendor', 'popName'].includes(column.field),
  })),
];

// interfaces: every catalog field; the common ones visible by default
const INTERFACE_VISIBLE = [
  'ifIndex',
  'ifName',
  'hostname',
  'ifAlias',
  'ifDescr',
  'ifTypeStr',
  'adminStatus',
  'operStatus',
  'ifSpeedText',
  'type',
  'specialService',
  'secondHost',
  'secondInterface',
  'isDeviceUpLink',
  'lastSyncTime',
];
const INTERFACE_FORMATTERS = {
  ifName: 'interfaceLinkFormatter',
  hostname: 'hostnameLinkFormatter',
  createdAt: 'dateFormatter',
  lastUpdate: 'dateFormatter',
  lastSyncTime: 'dateTimeFormatter',
  adminStatus: 'statusFormatter',
  operStatus: 'statusFormatter',
  counters: 'jsonFormatter',
  isDeviceUpLink: 'booleanFormatter',
  isPOPUpLink: 'booleanFormatter',
  apiFlag: 'booleanFormatter',
  noEnrichmentFlag: 'booleanFormatter',
  delete: 'booleanFormatter',
  ifSpeed: 'numberFormatter',
  ifHighSpeed: 'numberFormatter',
  ifHCInOctets: 'numberFormatter',
  ifHCOutOctets: 'numberFormatter',
  actualspeed: 'numberFormatter',
  sp_speed: 'numberFormatter',
};
const interfaces = [
  ...Interface.fieldCatalog.map((field) => ({
    field: field.name,
    title: field.label,
    visible: INTERFACE_VISIBLE.includes(field.name),
    formatter: INTERFACE_FORMATTERS[field.name],
    sortable: field.kind !== 'json',
  })),
  { field: 'createdBy', title: 'Created by', visible: false, sortable: false },
  { field: 'updatedBy', title: 'Updated by', visible: false, sortable: false },
];

const pops = [
  { field: 'name', title: 'Name', formatter: 'popLinkFormatter' },
  { field: 'acronym', title: 'Short name' },
  { field: 'popLongName', title: 'POP long name' },
  { field: 'cty', title: 'County' },
  { field: 'district', title: 'District' },
  { field: 'sector', title: 'Sector' },
  { field: 'popType', title: 'POP type' },
  { field: 'pop_cty', title: 'pop_cty', visible: false },
];

const links = [
  { field: 'device1', title: 'Device 1', formatter: 'hostnameLinkFormatter' },
  { field: 'interface1', title: 'Interface 1', sortable: false },
  { field: 'device2', title: 'Device 2', formatter: 'hostnameLinkFormatter' },
  { field: 'interface2', title: 'Interface 2', sortable: false },
  { field: 'type', title: 'Type' },
  { field: 'specialService', title: 'Special service', sortable: false },
  { field: 'pop1', title: 'POP 1', sortable: false },
  { field: 'pop2', title: 'POP 2', sortable: false },
  { field: 'label', title: 'Label', sortable: false, visible: false },
  {
    field: 'speed',
    title: 'Speed (bit/s)',
    sortable: false,
    visible: false,
    formatter: 'numberFormatter',
  },
  { field: 'createdAt', title: 'Created', formatter: 'dateFormatter', visible: false },
  { field: 'createdBy', title: 'Created by', sortable: false, visible: false },
];

const cabinets = [
  { field: 'cabinet', title: 'Cabinet', formatter: 'cabinetLinkFormatter' },
  { field: 'pop', title: 'POP' },
  { field: 'location', title: 'Location' },
  { field: 'locNotes', title: 'How to reach it', sortable: false },
  { field: 'createdAt', title: 'Created', formatter: 'dateFormatter', visible: false },
  { field: 'createdBy', title: 'Created by', sortable: false, visible: false },
];

const devicemodels = [
  { field: 'name', title: 'Model', formatter: 'devicemodelLinkFormatter' },
  { field: 'vendor', title: 'Vendor' },
  { field: 'type', title: 'Type' },
  { field: 'sysObjectIDs', title: 'sysObjectIDs', sortable: false },
  { field: 'notes', title: 'Notes', sortable: false, visible: false },
  { field: 'createdAt', title: 'Created', formatter: 'dateFormatter', visible: false },
  { field: 'createdBy', title: 'Created by', sortable: false, visible: false },
];

const btmsaninfos = [
  { field: 'msanCode', title: 'MSAN code', formatter: 'btmsaninfoLinkFormatter' },
  { field: 'mngIP', title: 'Management IP' },
  { field: 'sector', title: 'Sector' },
  { field: 'district', title: 'District' },
  { field: 'notes', title: 'Notes', sortable: false, visible: false },
  { field: 'createdAt', title: 'Created', formatter: 'dateFormatter', visible: false },
  { field: 'createdBy', title: 'Created by', sortable: false, visible: false },
];

const sectors = [
  { field: 'name', title: 'Name', formatter: 'sectorLinkFormatter' },
  { field: 'description', title: 'Description' },
  { field: 'createdBy', title: 'Created by', sortable: false, visible: false },
];

const counties = [
  { field: 'name', title: 'Name', formatter: 'countyLinkFormatter' },
  { field: 'acronym', title: 'Acronym' },
  { field: 'createdBy', title: 'Created by', sortable: false, visible: false },
];

const users = [
  { field: 'name', title: 'Name', formatter: 'userLinkFormatter' },
  { field: 'email', title: 'E-mail' },
  { field: 'role', title: 'Role' },
  { field: 'isAuthenticated', title: 'E-mail verified', formatter: 'booleanFormatter' },
];

const validatedusers = [
  { field: 'name', title: 'Name', formatter: 'validateduserLinkFormatter' },
  { field: 'email', title: 'E-mail' },
  { field: 'role', title: 'Role' },
  { field: 'createdBy', title: 'Added by', sortable: false, visible: false },
];

const auditlogs = [
  { field: 'at', title: 'When', formatter: 'dateTimeFormatter' },
  { field: 'action', title: 'Action', formatter: 'auditLinkFormatter' },
  { field: 'user', title: 'User' },
  { field: 'targetType', title: 'Target type', sortable: false },
  { field: 'target', title: 'Target', formatter: 'auditTargetFormatter' },
  { field: 'reason', title: 'Reason', sortable: false },
  { field: 'ip', title: 'IP', sortable: false, visible: false },
];

const ENRICHMENT_VISIBLE = [
  'SE_Name',
  'B_TED_Elt_Device',
  'B_TED_Elt_IP',
  'B_TED_Elt_Type',
  'B_TED_Elt_Vendor',
  'B_TED_Elt_POP_Name',
  'B_TED_service',
  'B_TED_provider',
  'B_TED_2ndHost',
  'B_TED_2ndPop',
];
const enrichments = Object.keys(Enrichment.schema.paths)
  .filter((name) => !['_id', '__v'].includes(name))
  .map((name) => ({ field: name, title: name, visible: ENRICHMENT_VISIBLE.includes(name) }));

module.exports = {
  enrichments,
  devices,
  decommissionedDevices,
  interfaces,
  pops,
  links,
  cabinets,
  devicemodels,
  btmsaninfos,
  sectors,
  counties,
  users,
  validatedusers,
  auditlogs,
};
