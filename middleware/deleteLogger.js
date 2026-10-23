const winston = require('winston');
const fs = require('fs');
const logDir = __dirname + '/..' + '/log/';
// Create the log directory if it does not exist
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}

const mainLogger = new winston.Logger({
  transports: [new winston.transports.Console()],
});

class CustomTransport extends winston.Transport {
  constructor(options) {
    super(options);
    this.name = 'customLogger';
    this.level = (options && options.level) || 'delete';
    this.levelOnly = options && options.levelOnly;
    // this.levels = options && options.levels || [];
    this.levels = options && options.levels;
  }

  log(level, msg, meta, callback) {
    if (!this.levelOnly || this.levels.indexOf(level) > -1) {
      mainLogger[level](msg, meta);
    }
    callback(null, true);
  }
}

winston.transports.CustomTransport = CustomTransport;

const myLogger = new winston.Logger({
  transports: [
    new winston.transports.CustomTransport({
      // levelOnly: true,
      levels: ['delete'],
    }),
  ],
});

// myLogger.delete('will be logged');

myLogger.afunc = function () {
  myLogger;
};

module.exports = myLogger;
