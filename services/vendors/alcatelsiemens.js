const generic = require('./generic');

/** Alcatel-Lucent / Siemens (ISAM / hiX) access nodes (MSAN port rules live in services/syncDevice.js). */
module.exports = {
  ...generic,
  name: 'alcatelsiemens',
  enterpriseOids: ['1.3.6.1.4.1.637', '1.3.6.1.4.1.231', '1.3.6.1.4.1.6527'],
  keywords: ['alcatel', 'isam', 'siemens', 'hix', 'nokia'],
};
