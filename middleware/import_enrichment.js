const fs = require('fs');
const Enrichment = require('../models/enrichment');
const Device = require('../models/device');
const enrichmentData = require('../lookUps/enrich');
const logger = require('../middleware/logger'); //logging component
const S = require('string');
let lineList = '';
const deviceList = [];
const deviceData = {
  B_TED_Elt_Device: 12,
  B_TED_Elt_IP: 13,
  B_TED_Elt_Model: 14,
  B_TED_Elt_POP_Gov: 15,
  B_TED_Elt_POP_Name: 16,
  B_TED_Elt_Type: 17,
  B_TED_Elt_Vendor: 18,
  CommunityString: 64,
};

// Go through the CSV file adding one enrichment document per line (and a
// device for every hostname not seen before); never rejects.
async function createDocRecurse(filename) {
  let contents;
  try {
    contents = await fs.promises.readFile(S(filename).s, 'utf8');
  } catch (err) {
    logger.error(err);
    return;
  }
  logger.info('reading enrichment file ' + S(filename).s);
  lineList = contents.toString().split('\n');
  for (let key = 1; key < lineList.length; key++) {
    //skip first header line
    const line = lineList[key];
    const doc = new Enrichment();
    const device = new Device();
    line.split(',').forEach(function (entry, i) {
      doc[enrichmentData.extendedEnrichmentFields[i]] = entry;
      if (i == deviceData.B_TED_Elt_Device) {
        //
        device.hostname = entry;
      } else if (i == deviceData.B_TED_Elt_IP) {
        //
        device.ipaddress = entry;
      } else if (i == deviceData.B_TED_Elt_Model) {
        device.model = entry;
      } else if (i == deviceData.B_TED_Elt_POP_Gov) {
        device.governorate.name = entry;
      } else if (i == deviceData.B_TED_Elt_POP_Name) {
        device.popName.name = entry;
      } else if (i == deviceData.B_TED_Elt_Type) {
        device.type = entry;
      } else if (i == deviceData.B_TED_Elt_Vendor) {
        device.vendor = entry;
      } else if (i == deviceData.CommunityString) {
        device.communityString = S(entry).s;
      }
    });
    try {
      await doc.save();
    } catch (error) {
      logger.error(error);
    }
    if (!deviceList.includes(device.hostname) && device.hostname) {
      logger.info('searching for device in enrichment mode');
      try {
        const foundDevice = await Device.findOne({ hostname: device.hostname });
        if (foundDevice) {
          logger.info('enriched device already in database');
        } else {
          await device.save();
        }
      } catch (error) {
        logger.error(error);
      }
    }
    // if(!deviceList.includes(device.hostname) && device.hostname) device.save();
    deviceList.push(device.hostname);
  }
}

module.exports.createDocRecurse = createDocRecurse;
