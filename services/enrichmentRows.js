/**
 * The legacy "enrichment" export (B_TED_* columns consumed by the BT
 * enrichment system), produced as a stream of flat rows: one row per device
 * plus one row per interface whose alias follows a naming convention.
 * Pure read-only generation (the former version rebuilt the Enrichment
 * collection and wrote a file on disk).
 */
const S = require('string');
const Device = require('../models/device');
const Link = require('../models/link');
const Enrichment = require('../models/enrichment');
const enrichmentData = require('../lookUps/enrich');
const parser = require('../middleware/parser/parser');

const MAX_COLLECTOR_LOAD = 30000;
const SERVICE_NAMES = { IPT: 'SRV-IPT', LP: 'SRV-LP' };

/** column names in the order of the enrichment sheet */
const COLUMNS = enrichmentData.enrichmentFields.map((field) => [field, field]);

function blankRow() {
  const row = {};
  for (const field of enrichmentData.enrichmentFields) row[field] = '';
  // schema defaults of the Enrichment model
  const defaults = new Enrichment().toObject();
  for (const field of enrichmentData.enrichmentFields) {
    if (defaults[field] !== undefined) row[field] = defaults[field];
  }
  return row;
}

/**
 * Rows for one device (device row first, then its interface rows).
 * `collectorsLoad` distributes devices over the 9 collectors across calls.
 */
async function* deviceRows(device, collectorsLoad) {
  const deviceDetails = parser.parseHostname(device.hostname);
  if (!deviceDetails) return; // hostname does not follow the naming rule
  const deviceRow = blankRow();
  deviceRow.B_TED_Elt_Device = S(device.hostname).s;
  for (let i = 0; i < 9; i++) {
    if (collectorsLoad[i] < MAX_COLLECTOR_LOAD) {
      deviceRow.B_TED_Default_Coll = i;
      collectorsLoad[i] += 1;
      break;
    }
  }
  deviceRow.B_TED_Elt_IP = S(device.ipaddress).s;
  deviceRow.B_TED_Elt_Model = S(device.model).s;
  deviceRow.B_TED_Elt_POP_Cty = deviceDetails.popCty;
  deviceRow.B_TED_Elt_POP_Name = deviceDetails.popName;
  deviceRow.B_TED_Elt_Type = deviceDetails.deviceType;
  deviceRow.B_TED_Elt_Vendor = deviceDetails.deviceVendor;
  deviceRow.B_TED_Label = deviceRow.B_TED_Elt_Device;
  deviceRow.B_TED_ShortLabel = deviceRow.B_TED_Elt_Device;
  deviceRow.SE_Name = S(device.hostname).s + '_if<NULL>';
  yield deviceRow;

  const seen = new Set();
  for (const intf of device.interfaces || []) {
    if (seen.has(intf.name)) continue; // avoid repetitions
    seen.add(intf.name);
    const link = parser.parseIfAlias(intf.alias);
    if (!link.pattern) continue; // alias does not follow any naming rule
    const row = blankRow();
    row.B_TED_Elt_Device = deviceRow.B_TED_Elt_Device;
    row.B_TED_Default_Coll = deviceRow.B_TED_Default_Coll;
    row.B_TED_linkBw = (intf.speed || 0) / 1000000;
    row.B_TED_ifDescrSt = intf.alias;
    row.B_TED_Elt_IP = deviceRow.B_TED_Elt_IP;
    row.B_TED_Elt_Model = deviceRow.B_TED_Elt_Model;
    row.B_TED_Elt_POP_Cty = deviceDetails.popCty;
    row.B_TED_Elt_POP_Name = deviceDetails.popName;
    row.B_TED_Elt_Type = deviceDetails.deviceType;
    row.B_TED_Elt_Vendor = deviceDetails.deviceVendor;
    row.SE_Name = S(device.hostname).s + '_if<' + intf.index + '>';
    row.B_TED_linkType = link.link.specialService;
    row.B_TED_Label = row.B_TED_Elt_Device + ' IF: ' + intf.index + ' ';
    if (!S(row.B_TED_linkBw).isEmpty() && parseInt(S(row.B_TED_linkBw)) > 1000) {
      row.B_TED_Label += row.B_TED_linkBw + ' Gbps ' + intf.description + ' to ' + intf.alias;
    } else {
      row.B_TED_Label += row.B_TED_linkBw + ' Mbps ' + intf.description + ' to ' + intf.alias;
    }
    if (row.B_TED_linkType === 'International') {
      row.B_TED_service = link.service ? SERVICE_NAMES[link.service] || link.service : 'NA';
      row.B_TED_provider = link.provider || 'NA';
      row.B_TED_termination = link.termination;
      row.B_TED_connType = link.connType;
      row.B_TED_bundleId = link.bundleId;
      row.B_TED_linkId = link.linkNumber;
      row.B_TED_intCID = link.CID;
      row.B_TED_teCID = link.BTCID;
      row.B_TED_subCable = link.subCable || 'NA';
      row.B_TED_isDeviceUplink = false;
      row.B_TED_isPopUplink = false;
    } else if (row.B_TED_linkType === 'Bitstream') {
      row.B_TED_Customer = link.customer;
    }
    if (row.B_TED_linkType === 'ESP') {
      row.B_TED_esp_customer = link.customer;
      row.B_TED_esp_conntype = link.connType;
      row.B_TED_esp_order = link.emsOrder;
      row.B_TED_esp_bw = link.connectedBW;
      row.B_TED_esp_pop = link.pop;
      row.B_TED_esp_if = '1';
      if (!S(row.B_TED_esp_bw).isEmpty() && parseInt(S(row.B_TED_esp_bw)) > 0) {
        row.B_TED_linkBw = row.B_TED_esp_bw;
      }
    }
    const foundLink = await Link.findOne({
      device1: row.B_TED_Elt_Device,
      interface1: intf.description,
    }).lean();
    if (foundLink) {
      row.B_TED_2ndHost = foundLink.device2;
      const second = parser.parseHostname(foundLink.device2);
      row.B_TED_2ndPop = second ? second.popName : '';
    }
    yield row;
  }
}

/** streams the enrichment rows of the devices matching `filter` */
async function* rows(filter = {}) {
  const collectorsLoad = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0 };
  const cursor = Device.find(filter).sort({ hostname: 1 }).lean().cursor();
  for await (const device of cursor) {
    yield* deviceRows(device, collectorsLoad);
  }
}

module.exports = { COLUMNS, rows, deviceRows, blankRow };
