const express = require('express');
const router = express.Router();
const Device = require('../models/device');
const Interface = require('../models/interface');
const POP = require('../models/pop');
const Sector = require('../models/sector');
const County = require('../models/county');
const Link = require('../models/link');
const middleware = require('../middleware');
const snmpSession = require('../services/snmpSession');
const pagination = require('../services/pagination');
const config = require('../config');
const seedDB = require('../seeds');
const snmpConstants = require('../lookUps');
const S = require('string');
const mongoose = require('mongoose');
const logger = require('../middleware/logger');

//*********************
//  SNMP HANDLER
//*********************
// The maxRepetitions argument is optional, and will be ignored unless using
// SNMP verison 2c
const syncCyclesThreshold = 3;
const maxRepetitions = config.snmp.maxRepetitions;
const ifTableColumns = {
  ifIndex: 1,
  ifDescr: 2,
  ifType: 3,
  ifSpeed: 5,
  ifAdminStatus: 7,
  ifOperStatus: 8,
};
const ifXTableColumns = { ifName: 1, ifAlias: 18 };
const oids = {
  ifTable: {
    OID: '1.3.6.1.2.1.2.2',
    Columns: [
      ifTableColumns.ifIndex,
      ifTableColumns.ifDescr,
      ifTableColumns.ifType,
      ifTableColumns.ifSpeed,
      ifTableColumns.ifAdminStatus,
      ifTableColumns.ifOperStatus,
    ],
  },
  ifXTable: {
    OID: '1.3.6.1.2.1.31.1.1',
    Columns: [ifXTableColumns.ifName, ifXTableColumns.ifAlias],
  },
};
//SNMP Table
function sortInt(a, b) {
  if (a > b) return 1;
  else if (b > a) return -1;
  else return 0;
}

function discoveredDevice(device) {
  const self = this;
  self.name = device.hostname;
  self.device = device;
  self.interfaces = [];
  self.interestKeys = [];
  self.interestInterfaces = [];
  self.interestInterfacesIndices = []; //this will make iterating on interfaces during sync mode faster
  self.interfaceUpdateList = [];
  self.interfaceRemoveList = [];
  self.ifTableError = false;
  self.ifXTableError = false;
  self.ifTableRead = false;
  self.ifXTableRead = false;
  self.inSyncMode = false;
  self.session = snmpSession.createSession({
    host: self.device.ipaddress,
    community: S(self.device.community || self.device.communityString).trim().s,
    timeoutMs: config.snmp.timeoutMs,
    onError: function (error) {
      logger.error('device ' + self.name + ' SNMP session error: ' + error);
    },
  });
  // promise-returning (oid, columns, maxRepetitions) -> table
  self.tableColumns = function (oid, columns, maxRepetitions) {
    return self.session.tableColumns(oid, columns, maxRepetitions);
  };

  //parse ifAlias
  self.parseInternationalInterfaces = function (ifAlias) {
    // not implemented yet: the alias is only split for inspection
    S(ifAlias).trim().splitLeft('-');
  };

  self.saveDevice = async function (device) {
    try {
      await Device.findByIdAndUpdate(device._id, {
        interfaces: self.interestInterfaces,
        discovered: true,
      });
    } catch (error) {
      logger.error(error);
    }
  };
  self.getInterfaceFromInterestList = function (interfaceIndex) {
    let intf = new Interface();
    self.interestInterfaces.forEach(function (interface) {
      if (interface.index == interfaceIndex) {
        intf = {
          index: interface.index,
          speed: interface.speed,
          name: interface.name,
          alias: interface.alias,
          description: interface.description,
          type: interface.type,
        };
      }
    });
    return intf;
  };
  self.removeInterfaceFromInterestList = function (interfaceIndex) {
    logger.info('removing Interface with ifIndex = ' + interfaceIndex + ' From InterestList');
    for (let i = 0; i < self.interestInterfaces.length; i++) {
      if (self.interestInterfaces[i].index == interfaceIndex) {
        //remove interface from the list
        self.interestInterfaces.splice(i, 1);
        break;
      }
    }
  };

  self.retrieveIfTable = function (table) {
    const indexes = [];
    for (const index in table) {
      indexes.push(parseInt(index));
    }
    indexes.sort(sortInt);

    // Use the sorted indexes we've calculated to walk through each
    // row in order
    Object.keys(table).forEach(function (key) {
      const value = table[key];
      const anInterface = new Interface();
      anInterface.device = self.device;
      anInterface.author = { id: self.device.author.id, email: self.device.author.email };
      anInterface.index = value[ifTableColumns.ifIndex];
      anInterface.description = value[ifTableColumns.ifDescr];
      anInterface.ifType = value[ifTableColumns.ifType];
      anInterface.speed = value[ifTableColumns.ifSpeed];
      anInterface.adminStatus = value[ifTableColumns.ifAdminStatus];
      anInterface.operStatus = value[ifTableColumns.ifOperStatus];
      if (
        anInterface.adminStatus == snmpConstants.ifAdminOperStatus.up &&
        anInterface.operStatus == snmpConstants.ifAdminOperStatus.up &&
        !S(anInterface.description).contains('mpls')
      ) {
        self.interfaces[key] = anInterface;
        self.interestKeys.push(key); //push index to be used during ifXTable walk
      }
    });
    self.ifTableError = false;
    self.ifXTableError = false;
    return self.interfaces;
  };
  self.retrieveIfXTable = function (table) {
    const indexes = [];
    for (const index in table) {
      indexes.push(parseInt(index));
    }
    indexes.sort(sortInt);

    // Use the sorted indexes we've calculated to walk through each
    // row in order
    Object.keys(table).forEach(function (key) {
      const value = table[key];
      if (self.interestKeys.includes(key)) {
        const intf = self.interfaces[key];
        intf.name = value[ifXTableColumns.ifName];
        intf.alias = value[ifXTableColumns.ifAlias];
        let name = S(intf.name).toString();
        name = name.toLowerCase();
        let alias = S(intf.alias).toString();
        alias = alias.toLowerCase();
        //check if ifAlias contains any of the following:
        // 1-INT
        // 2-BITSTREAM
        // 3-ESP
        // 4-NR
        // 5-FW
        if (
          // !S(alias).isEmpty() && !S(alias).contains("interface") &&
          S(alias).startsWith('int-') ||
          S(alias).contains('bitstream') ||
          S(alias).contains('_enb_') ||
          S(alias).startsWith('esp-') ||
          S(alias).startsWith('nr_') ||
          S(alias).startsWith('reserved') ||
          S(alias).contains('-fw')
        ) {
          self.interestInterfaces.push(intf);
          self.parseInternationalInterfaces(intf.alias);
          self.interestInterfacesIndices.push(intf.index);
        }
        // check interface is main i.e. doesn't contain '.' and ':'
        let tempArray,
          tempField1 = '',
          tempField2 = '',
          tempField3 = '';
        if (
          !S(name).contains('.') &&
          !S(name).contains(':') &&
          !S(name).isEmpty() &&
          S(name).contains('/')
        ) {
          tempArray = S(name).splitLeft('/');
          tempField1 = tempArray[0];
          tempField2 = tempArray[1];
          tempField3 = tempArray[2];
        }
        logger.info(name);
        if (
          !S(tempField1).isEmpty() &&
          !S(tempField2).isEmpty() &&
          !S(tempField3).isEmpty() &&
          S(tempField1).isNumeric() &&
          S(tempField2).isNumeric() &&
          S(tempField3).isNumeric()
        ) {
          self.interestInterfaces.push(intf);
          self.parseInternationalInterfaces(intf.alias);
          self.interestInterfacesIndices.push(intf.index);
        }

        if (
          !S(name).contains('.') &&
          !S(name).contains(':') &&
          !S(name).isEmpty() &&
          !S(name).startsWith('galway') &&
          (S(name).startsWith('100ge') ||
            S(name).startsWith('bundle-ether') ||
            S(name).startsWith('hundredgige') ||
            S(name).startsWith('ae') ||
            S(name).startsWith('at') ||
            S(name).startsWith('e1') ||
            S(name).startsWith('et') ||
            S(name).startsWith('fa') ||
            S(name).startsWith('fe-') ||
            S(name).startsWith('ge-') ||
            S(name).startsWith('gi') ||
            S(name).startsWith('po') ||
            S(name).startsWith('se') ||
            S(name).startsWith('so-') ||
            S(name).startsWith('te') ||
            S(name).startsWith('xe-'))
        ) {
          self.interestInterfaces.push(intf);
          self.parseInternationalInterfaces(intf.alias);
          self.interestInterfacesIndices.push(intf.index);
        }
      }
    });
    self.ifTableError = false;
    self.ifXTableError = false;
    return self.interestInterfaces;
  };
  self.createInterfaces = async function (interfaceList) {
    for (let i = 0; i < interfaceList.length; i++) {
      try {
        const interface = await Interface.create(interfaceList[i]);
        //populate some enrichment information automatically
        const foundLink = await Link.findOne({
          device1: S(self.device.hostname),
          interface1: S(interface.name),
        });
        if (foundLink) {
          interface.secondHost = foundLink.device2;
          const foundDevice = await Device.findOne({ hostname: S(foundLink.device2).trim() });
          if (foundDevice) {
            interface.secondPOP = foundDevice.popName.name;
            await interface.save();
          } else {
            logger.info('device2 from Link collection was not found!');
          }
        } else {
          logger.info('link not found!');
        }
      } catch (error) {
        logger.error(error);
      }
    }
  };
  self.updateInterfaces = async function (interfaceList) {
    for (let i = 0; i < interfaceList.length; i++) {
      try {
        const updatedInterface = await Interface.findByIdAndUpdate(
          interfaceList[i]._id,
          interfaceList[i]
        );
        await updatedInterface.save();
      } catch (error) {
        logger.error(error);
      }
    }
  };
  self.removeInterfaces = async function (interfaceList) {
    for (let i = 0; i < interfaceList.length; i++) {
      try {
        await Interface.findByIdAndDelete(interfaceList[i]._id);
        logger.info('successfully removed interface');
      } catch (error) {
        logger.error(error);
      }
    }
  };
  self.processIfXTable = async function (table) {
    if (self.inSyncMode) {
      self.retrieveIfXTable(table);
      self.device.interfaces.forEach(function (interface) {
        const syncCycles = S(interface.syncCycles).toInt();
        interface.syncCycles = syncCycles + 1;
        logger.info(
          interface.index +
            ': ' +
            interface.name +
            ' , ' +
            interface.updated +
            ' , syncCycles ' +
            interface.syncCycles
        );
        //content of interestInterfaces are the found interfaces in the current sync cycles
        // if: current interface index found in interestInterfaces and interface not updated, then: update interface
        if (
          self.interestInterfacesIndices.includes(interface.index) &&
          interface.updated === undefined
        ) {
          const intf = self.getInterfaceFromInterestList(interface.index);
          interface.name = intf.name;
          interface.alias = intf.alias;
          interface.description = intf.description;
          interface.type = intf.type;
          interface.speed = intf.speed;
          interface.delete = false;
          interface.syncCycles = 0;
          self.interfaceUpdateList.push(interface);
          logger.info(
            'found interface ' +
              interface.name +
              ' with index ' +
              interface.index +
              ', with update state ' +
              interface.updated
          );
          //remove interface from list of interest interfaces as it is already exists
          self.removeInterfaceFromInterestList(interface.index);
        }
        // if: current interface index not found and updated and syncCyles > threshold, then: let "delete = true" and update interface
        if (
          !self.interestInterfacesIndices.includes(interface.index) &&
          interface.updated instanceof Date &&
          interface.syncCycles > syncCyclesThreshold
        ) {
          const intf = self.getInterfaceFromInterestList(interface.index);
          interface.name = intf.name;
          interface.alias = intf.alias;
          interface.description = intf.description;
          interface.type = intf.type;
          interface.speed = intf.speed;
          // interface.syncCycles = syncCycles + 1;
          interface.delete = true;
          self.interfaceUpdateList.push(interface);
        } else if (
          !self.interestInterfacesIndices.includes(interface.index) &&
          interface.updated instanceof Date &&
          interface.syncCycles <= syncCyclesThreshold
        ) {
          self.interfaceUpdateList.push(interface);
        }
        // if: current interface index not found and not updated and syncCyles > threshold, then: delete interface
        if (
          !self.interestInterfacesIndices.includes(interface.index) &&
          interface.updated === undefined &&
          interface.syncCycles > syncCyclesThreshold
        ) {
          self.interfaceRemoveList.push(interface);
          logger.warn(
            'interface: \n\n\n' +
              interface.name +
              " will be deleted automatically, it's syncCycle= " +
              interface.syncCycles
          );
        } else if (
          !self.interestInterfacesIndices.includes(interface.index) &&
          interface.updated === undefined &&
          interface.syncCycles <= syncCyclesThreshold
        ) {
          logger.warn(
            'interface: \n\n\n' +
              interface.name +
              " wasn't found during this sync cycle, it's syncCycle= " +
              interface.syncCycles
          );
          self.interfaceUpdateList.push(interface);
        }
        // if: current interface index found in interestInterfaces and interface updated, then: skip
        if (
          self.interestInterfacesIndices.includes(interface.index) &&
          interface.updated instanceof Date
        ) {
          //remove interface from list of interest interfaces as it is already exists
          interface.syncCycles = 0;
          self.interfaceUpdateList.push(interface);
          self.removeInterfaceFromInterestList(interface.index);
        }
        // if: new interface index, then create interface (handled by createInterfaces below)
      });
      if (self.interestInterfaces.length > 0) await self.createInterfaces(self.interestInterfaces);
      if (self.interfaceUpdateList.length > 0)
        await self.updateInterfaces(self.interfaceUpdateList);
      if (self.interfaceRemoveList.length > 0)
        await self.removeInterfaces(self.interfaceRemoveList);
      //now the device will use interestInterfaces array during save action, so modify it to include only new and updated
      //interfaces
      self.interestInterfaces = self.interestInterfaces.concat(self.interfaceUpdateList);
      await self.saveDevice(self.device);
    } else {
      await self.createInterfaces(self.retrieveIfXTable(table));
      await self.saveDevice(self.device);
    }
  };
  // walk ifTable then ifXTable over SNMP and process the result; never rejects
  self.walkTables = async function () {
    try {
      let table;
      try {
        table = await self.tableColumns(oids.ifTable.OID, oids.ifTable.Columns, maxRepetitions);
      } catch (error) {
        logger.error('device ' + self.name + ' has ' + error.toString() + ' while reading ifTable');
        self.ifTableError = true;
        self.ifXTableError = true;
        return;
      }
      self.retrieveIfTable(table);
      let xTable;
      try {
        xTable = await self.tableColumns(oids.ifXTable.OID, oids.ifXTable.Columns, maxRepetitions);
      } catch (error) {
        logger.error(error.toString());
        logger.error(
          'device ' + self.name + ' has ' + error.toString() + ' while reading ifXTable'
        );
        self.ifTableError = true;
        self.ifXTableError = true;
        return;
      }
      try {
        await self.processIfXTable(xTable);
      } catch (error) {
        logger.error(error);
      }
    } finally {
      // release the UDP socket once the walk is over (the old code leaked one per walk)
      self.session.close();
    }
  };
  this.syncInterfaces = async function () {
    self.inSyncMode = true;
    logger.info('starting ' + self.name + ' sync process');
    // discover new list of filtered interface indices
    // if: current interface index found in list and interface updated, then: skip
    // if: current interface index found in list and interface not updated, then: update interface
    // if: current interface index not found and updated and syncCyles > threshold, then: let "delete = true" and update interface
    // if: current interface index not found and not updated and syncCyles > threshold, then: delete interface
    // if: new interface index, then create interface
    await self.walkTables();
  };
  this.discoverInterfaces = async function () {
    logger.info(
      self.name +
        ' ' +
        self.device.ipaddress +
        ' ' +
        (self.device.community || self.device.communityString)
    );
    await self.walkTables();
  };
}
/**
 * Reads the free-text device fields of a submitted form (see
 * Device.editableTextFields): every value is trimmed; empty values fall back
 * to the schema default when the field has one, otherwise they are left out
 * on create / cleared on update. `community` also accepts the legacy
 * `communityString` input name and is mirrored into `communityString`.
 */
function deviceFieldsFromForm(form, { forUpdate } = {}) {
  const fields = {};
  for (const name of Device.editableTextFields) {
    let raw = form[name];
    if (name === 'community' && (raw === undefined || raw === '')) {
      raw = form.communityString;
    }
    let value = typeof raw === 'string' ? raw.trim() : raw;
    if (value === '' || value === undefined || value === null) {
      const schemaDefault = Device.schema.path(name).defaultValue;
      value =
        schemaDefault !== undefined
          ? schemaDefault
          : forUpdate && raw !== undefined
            ? ''
            : undefined;
    }
    if (value !== undefined) {
      fields[name] = value;
    }
  }
  if (fields.community !== undefined) {
    fields.communityString = fields.community;
  }
  return fields;
}

// bootstrap-table server-side pagination: GET /devices/pagination?limit&offset&search&sort&order
const devicePaginationSpec = {
  Model: Device,
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
    };
  },
};
router.get('/pagination', middleware.isLoggedIn, async function (request, response) {
  response.json(await pagination.paginatedResponse(request.query, devicePaginationSpec));
});

//INDEX - the device list is loaded by the table from /devices/pagination
router.get('/', middleware.isLoggedIn, function (request, response) {
  response.render('devices/index');
});

//CREATE - add new device to DB
router.post('/', middleware.isLoggedIn, async function (request, response) {
  //get data from a form and add to devices array
  const hostname = request.body.device.hostname;
  const ipaddress = request.body.device.ipaddress;
  const textFields = deviceFieldsFromForm(request.body.device);
  // let popName = request.body.device.popName;
  let popId = request.body.device.popName.name;
  // let sector = request.body.device.sector;
  let sectorId = request.body.device.sector.name;
  // let county = request.body.device.county;
  let countyId = request.body.device.county.name;
  ///
  let aPOP = new POP();
  let aSector = new Sector();
  let aCty = new County();
  let emptySector = false;
  let emptyPOP = false;
  let emptyCty = false;

  if (sectorId === 'NONE') {
    emptySector = true;
    logger.info('sector name is: ' + sectorId);
    try {
      aSector = (await Sector.findOne({ name: 'NONE' })) || aSector;
    } catch (error) {
      logger.error(error);
    }
  }
  if (popId === 'NONE') {
    emptyPOP = true;
    logger.info('pop name is: ' + popId);
    try {
      aPOP = (await POP.findOne({ name: 'NONE' })) || aPOP;
    } catch (error) {
      logger.error(error);
    }
  }
  if (countyId === 'NONE') {
    emptyCty = true;
    logger.info('cty name is: ' + countyId);
    try {
      aCty = (await County.findOne({ name: 'NONE' })) || aCty;
    } catch (error) {
      logger.error(error);
    }
  }

  if (S(emptySector).toBoolean()) {
    sectorId = aSector._id || request.body.device.sector.name;
    logger.info('sector id is: ' + sectorId);
  }
  if (S(emptyPOP).toBoolean()) {
    popId = aPOP._id || request.body.device.popName.name;
    logger.info('pop id is: ' + popId);
  }
  if (S(emptyCty).toBoolean()) {
    countyId = aCty._id || request.body.device.county.name;
    logger.info('cty id is: ' + countyId);
  }

  if (popId === undefined) {
    return;
  }
  let foundPOP;
  try {
    foundPOP = await POP.findById(popId);
  } catch (error) {
    logger.error(error);
    return;
  }
  if (sectorId === 'NONE') {
    return;
  }
  let foundSector;
  try {
    foundSector = await Sector.findById(sectorId);
  } catch (error) {
    logger.error(error);
    return;
  }
  if (countyId === undefined) {
    return;
  }
  let foundCty;
  try {
    foundCty = await County.findById(countyId);
  } catch (error) {
    logger.error(error);
    console.log(error);
    return;
  }
  console.log(foundCty);
  ///here goes correct values
  const aDevice = Object.assign({}, textFields, {
    hostname: hostname.trim(),
    ipaddress: ipaddress.trim(),
    author: { id: request.user._id, email: request.user.email },
    popName: foundPOP,
    sector: foundSector,
    county: foundCty,
  });
  aDevice.interfaces = [];
  logger.info('Device discovery started');
  let device;
  try {
    device = await Device.create(aDevice);
  } catch (error) {
    logger.log(error.errors);
    for (const field in error.errors) {
      request.flash('error', error.errors[field].message);
    }
    return response.redirect('/devices'); //will redirect as a GET request
  }
  logger.info('new device created and saved');
  request.flash('success', 'Successfully added device, will start device discovery now');
  const discoDevice = new discoveredDevice(device);
  discoDevice.discoverInterfaces(); // runs in the background, handles its own errors
  response.redirect('/devices'); //will redirect as a GET request
});

//NEW - show form to create new device
//should show the form will post data to /devices
router.get('/new', middleware.isLoggedIn, function (request, response) {
  if (config.seed) {
    seedDB(request.user);
  }
  response.render('devices/new');
});

//Sync devices
const syncDevices = async function () {
  logger.warn('Checking if devices ready for sync!!!!!!!!!!!');
  let foundDevices;
  try {
    foundDevices = await Device.find({});
  } catch (err) {
    logger.error(err);
    return;
  }
  foundDevices.forEach(function (device) {
    // if(device.discovered){//only handle discovered devices
    logger.info('device ' + device.hostname + ' will be synced now');
    // perform interface sync
    const discoDevice = new discoveredDevice(device);
    discoDevice.syncInterfaces();
    // }
  });
};
router.get('/sync', middleware.isLoggedIn, function (request, response) {
  syncDevices(); // runs in the background, handles its own errors
  response.redirect('/devices');
});
router.get('/sync/:id', middleware.isLoggedIn, async function (request, response) {
  // syncDevices();
  logger.info('syncing one device');
  logger.info(request.params.id);

  try {
    const foundDevice = await Device.findById(request.params.id);
    logger.info('single sync mode, device ' + foundDevice.hostname + ' will be synced now');
    // perform interface sync
    const discoDevice = new discoveredDevice(foundDevice);
    discoDevice.syncInterfaces();
  } catch (err) {
    logger.error(err);
  }

  response.redirect('/devices');
});

//SHOW DEVICE ROUTE
router.get('/:id', middleware.isLoggedIn, async function (request, response) {
  const foundDevice = await middleware.findByIdOr404(
    Device,
    request.params.id,
    response,
    'Device',
    '/devices'
  );
  if (!foundDevice) return;
  //render show template with that device
  response.render('devices/show', { device: foundDevice });
});

//EDIT DEVICE ROUTE
router.get('/:id/edit', middleware.isLoggedIn, async function (request, response) {
  //is user logged in?
  logger.info('Update a device');
  const foundDevice = await middleware.findByIdOr404(
    Device,
    request.params.id,
    response,
    'Device',
    '/devices'
  );
  if (!foundDevice) return;
  response.render('devices/edit', { device: foundDevice });
});
//UPDATE DEVICE ROUTE
router.put('/:id', middleware.isLoggedIn, async function (request, response) {
  //find and update the correct DEVICE
  const form = request.body.device;
  const updates = deviceFieldsFromForm(form, { forUpdate: true });
  updates.updatedAt = new Date();
  updates.lastUpdatedBy = { id: request.user._id, email: request.user.email };
  if (form.sector) {
    updates.sector = form.sector;
  }
  // note: Select2 has a defect which removes pop name and replace it with the id
  if (
    !form.popName ||
    !mongoose.isValidObjectId(form.popName.name) ||
    !form.county ||
    !mongoose.isValidObjectId(form.county.name)
  ) {
    request.flash('error', 'Please choose the POP and the county from the lists');
    return response.redirect('/devices/' + request.params.id + '/edit');
  }
  const popObjectId = new mongoose.Types.ObjectId(form.popName.name);
  const ctyObjectId = new mongoose.Types.ObjectId(form.county.name);
  let foundPOP;
  try {
    foundPOP = await POP.findById({ _id: popObjectId });
  } catch (error) {
    logger.error(error);
    return response.redirect('/devices/' + request.params.id);
  }
  updates.popName = Object.assign({}, form.popName, { name: foundPOP.name });
  let foundCty;
  try {
    foundCty = await County.findById({ _id: ctyObjectId });
  } catch (error) {
    logger.error(error);
    return response.redirect('/devices/' + request.params.id);
  }
  updates.county = Object.assign({}, form.county, { name: foundCty.name });
  try {
    await Device.findByIdAndUpdate(request.params.id, updates);
  } catch (error) {
    logger.error(error);
    return response.redirect('/devices');
  }
  //redirect somewhere (show page)
  response.redirect('/devices/' + request.params.id);
});
//DESTROY Device ROUTE
router.delete('/:id', middleware.isLoggedIn, async function (request, response) {
  logger.warn('Deleting device with id: ' + request.params.id);
  if (request.params.id == -1) {
    response.redirect('/devices');
  }
  //find list of interfaces
  let foundDevice;
  try {
    foundDevice = await Device.findById(request.params.id);
    const interfaceList = foundDevice.interfaces;
    //iterate over them and delete
    for (let i = 0; i < interfaceList.length; i++) {
      try {
        await Interface.findByIdAndDelete(interfaceList[i]._id);
      } catch (error) {
        logger.error(error);
      }
    }
  } catch (error) {
    logger.error(error);
  }
  try {
    await Device.findByIdAndDelete(request.params.id);
  } catch (error) {
    logger.error(error);
  }
  response.redirect('/devices');
});

module.exports = router;
module.exports.syncDevices = syncDevices;
