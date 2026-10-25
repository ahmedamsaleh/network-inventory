const express = require('express');
const router = express.Router({ mergeParams: true });
const Enrichment = require('../models/enrichment');
const Link = require('../models/link');
const Device = require('../models/device');
const middleware = require('../middleware');
const importEnrichment = require('../middleware/import_enrichment');
const logger = require('../middleware/logger'); //logging component
const linkParser = require('../middleware/parser');
const enrichmentData = require('../lookUps/enrich');
const fs = require('fs');
const config = require('../config');
const S = require('string');
const through = require('through');
let csv = enrichmentData.enrichmentFields + '\n';

const appendMode = true;
let fileUploadPath;
let fileExportPath;
let parsedInterfaces = [];
const maxCollectorLoad = 30000;
const collectorsLoad = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 };

if (config.isWindows) {
  fileUploadPath = __dirname + '\\..\\import\\';
  fileExportPath = __dirname + '\\..\\export\\';
} else {
  fileUploadPath = __dirname + '/../import/';
  fileExportPath = __dirname + '/../export/';
}
//INDEX - show all enrichment data
router.get('/', middleware.isLoggedIn, async function (request, response) {
  let foundEnrichments;
  try {
    foundEnrichments = await Enrichment.find({});
  } catch (error) {
    logger.error(error);
    return;
  }
  response.render('enrichments/index', { enrichments: foundEnrichments });
});

// builds the enrichment collection + CSV for every device; never rejects
async function exportEnrichment() {
  // This opens up the writeable stream to exportedEnrichment.csv
  fs.createWriteStream(fileExportPath + 'exportedEnrichment.csv');
  try {
    await Enrichment.deleteMany({});
    logger.info('collection removed');
    //retrieve list of devices
    const foundDevices = await Device.find({});
    for (const device of foundDevices) {
      logger.info('device ' + device.hostname + ' information will be retrieved for export');
      //start with the device itself then iterate over its interfaces
      const deviceDoc = new Enrichment();
      deviceDoc.B_TED_Elt_Device = S(device.hostname).s;
      //distribute resources on different collectors
      for (let i = 0; i < 9; i++) {
        if (collectorsLoad[i] < maxCollectorLoad) {
          deviceDoc.B_TED_Default_Coll = i;
          collectorsLoad[i] = collectorsLoad[i] + 1;
          break;
        }
      }

      const deviceDetails = await linkParser.parseHostname(deviceDoc.B_TED_Elt_Device);
      if (deviceDetails == null) {
        continue;
      }
      deviceDoc.B_TED_Elt_IP = S(device.ipaddress).s;
      deviceDoc.B_TED_Elt_Model = S(device.model).s;
      deviceDoc.B_TED_Elt_POP_Cty = deviceDetails.popCty;
      deviceDoc.B_TED_Elt_POP_Name = deviceDetails.popName;
      deviceDoc.B_TED_Elt_Type = deviceDetails.deviceType;
      deviceDoc.B_TED_Elt_Vendor = deviceDetails.deviceVendor;
      deviceDoc.B_TED_Label = deviceDoc.B_TED_Elt_Device;
      deviceDoc.B_TED_ShortLabel = deviceDoc.B_TED_Elt_Device;
      deviceDoc.SE_Name = S(device.hostname).s + '_if<NULL>';
      await saveQuietly(deviceDoc);
      csv += enrichmentRow(deviceDoc);
      //retrieve list of interfaces
      parsedInterfaces = [];
      for (const interface of device.interfaces) {
        //parse each device alias
        if (parsedInterfaces.includes(interface.name)) {
          //added this condition to avoid repetitions
          continue;
        }
        parsedInterfaces.push(interface.name);
        const link = linkParser.parseIfAlias(interface.alias);
        if (link == null) {
          continue;
        }
        const doc = new Enrichment();
        doc.B_TED_Elt_Device = S(device.hostname).s;
        doc.B_TED_Default_Coll = deviceDoc.B_TED_Default_Coll;
        doc.B_TED_linkBw = interface.speed / 1000000;
        doc.B_TED_ifDescrSt = interface.alias;
        doc.B_TED_Elt_IP = S(device.ipaddress).s;
        doc.B_TED_Elt_Model = S(device.model).s;
        doc.B_TED_Elt_POP_Cty = deviceDetails.popCty;
        doc.B_TED_Elt_POP_Name = deviceDetails.popName;
        doc.B_TED_Elt_Type = deviceDetails.deviceType;
        doc.B_TED_Elt_Vendor = deviceDetails.deviceVendor;
        doc.SE_Name = S(device.hostname).s + '_if<' + interface.index + '>';
        doc.B_TED_linkType = link.linkType;
        //B_TED_Label = B_TED_Elt_Device+" IF: "+ifIndex+" "+B_TED_linkBw+" "+ifDesc+" to "+ifAlias
        doc.B_TED_Label = doc.B_TED_Elt_Device + ' IF: ' + interface.index + ' ';
        if (!S(doc.B_TED_linkBw).isEmpty() && parseInt(S(doc.B_TED_linkBw)) > 1000) {
          doc.B_TED_Label =
            doc.B_TED_Label +
            doc.B_TED_linkBw +
            ' Gbps ' +
            interface.description +
            ' to ' +
            interface.alias;
        } else {
          doc.B_TED_Label =
            doc.B_TED_Label +
            doc.B_TED_linkBw +
            ' Mbps ' +
            interface.description +
            ' to ' +
            interface.alias;
        }

        if (doc.B_TED_linkType == 'International') {
          doc.B_TED_service = link.service;
          doc.B_TED_provider = link.provider;
          doc.B_TED_termination = link.termination;
          doc.B_TED_connType = link.connType;
          doc.B_TED_bundleId = link.bundelID;
          doc.B_TED_linkId = link.linkID;
          doc.B_TED_intCID = link.intCID;
          doc.B_TED_teCID = link.teCID;
          doc.B_TED_subCable = link.subCable;
          doc.B_TED_isDeviceUplink = false;
          doc.B_TED_isPopUplink = false;
        } else if (doc.B_TED_linkType == 'BITSTREAM') {
          doc.B_TED_Customer = link.customer;
        }
        if (link.isESP == '1') {
          doc.B_TED_esp_customer = link.espCustomer;
          doc.B_TED_esp_conntype = link.espConnType;
          doc.B_TED_esp_order = link.espEmsOrder;
          doc.B_TED_esp_bw = link.espBW;
          doc.B_TED_esp_pop = link.espPop;
          doc.B_TED_esp_if = '1';
          if (!S(doc.B_TED_esp_bw).isEmpty() && parseInt(S(doc.B_TED_esp_bw)) > 0) {
            doc.B_TED_linkBw = doc.B_TED_esp_bw;
          }
        }
        try {
          const foundLink = await Link.findOne({
            device1: doc.B_TED_Elt_Device,
            interface1: interface.description,
          });
          if (foundLink != null) {
            doc.B_TED_2ndHost = foundLink.device2;
            const secondDetails = await linkParser.parseHostname(doc.B_TED_2ndHost);
            doc.B_TED_2ndPop = secondDetails ? secondDetails.popName : undefined;
          } else {
            logger.error(
              "can't find second host for the device " +
                doc.B_TED_Elt_Device +
                ' on interface ' +
                interface.description
            );
          }
        } catch (error) {
          logger.error(error);
        }
        await saveQuietly(doc);
        await saveQuietly(deviceDoc);
        csv += enrichmentRow(doc);
      } //interface loop
    } //device loop

    await new Promise(function (resolve) {
      const stream = through(
        function write(data) {
          this.emit('data', data);
        },
        function end() {
          this.emit('end');
        }
      );
      const lines = [];
      stream
        .on('data', function (data) {
          lines.push(data);
        })
        .on('end', function () {
          resolve();
        });

      // call and invoke the stream
      Enrichment.find().csv(stream);
    });
    fs.appendFileSync(
      fileExportPath + 'exportedEnrichment.csv',
      S(csv).replaceAll('undefined', '').s
    );
    //re-initialize for next export
    csv = enrichmentData.enrichmentFields + '\n';
  } catch (error) {
    logger.error(error);
  }
}

async function saveQuietly(doc) {
  try {
    await doc.save();
  } catch (error) {
    logger.error(error);
  }
}

// one CSV line for an enrichment document, in the enrichmentFields column order
function enrichmentRow(doc) {
  return (
    enrichmentData.enrichmentFields
      .map(function (field) {
        return doc[field];
      })
      .join(',') + '\n'
  );
}

router.get('/export', middleware.isLoggedIn, function (request, response) {
  //update device info in the enrichment data
  logger.error('will start creating enrichment file inside ' + fileExportPath);
  exportEnrichment(); // runs in the background, handles its own errors

  request.flash('success', 'Enrichment data exported');
  return response.redirect('/home');
});

//NEW - show form to create new Enrichment
//should show the form will post data to /enrichments
router.get('/new', middleware.isLoggedIn, function (request, response) {
  response.render('enrichments/new');
});

//CREATE - add new enrichment to DB
router.post('/', middleware.isLoggedIn, async function (request, response) {
  logger.info('importing enrichment data');

  if (!request.files || !request.files.file)
    return response.status(400).send('No files were uploaded.');
  const sampleFile = request.files.file;
  const filename = sampleFile.name;
  logger.info('uploading enrichment file ' + filename);
  try {
    await sampleFile.mv(fileUploadPath + filename);
  } catch (err) {
    return response.status(500).send(err);
  }
  //check if we will create new collection or we will append on the old one
  //default is to append
  if (appendMode == false) {
    try {
      await Enrichment.deleteMany({});
      logger.error('collection removed');
    } catch (error) {
      logger.error(error);
      return;
    }
    importEnrichment.createDocRecurse(fileUploadPath + filename); // background, handles its own errors
    return;
  }
  importEnrichment.createDocRecurse(fileUploadPath + filename); // background, handles its own errors
  // populateEnrichmentData();
  response.redirect('/enrichments');
  // response.redirect('/devices');
});
module.exports = router;
