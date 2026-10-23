const Device = require('./models/device'),
  Interface = require('./models/interface');
let user;

const data = [
  {
    hostname: 'Area1',
    ipaddress: '<SUBNET>.1',
    author: user,
  },
  {
    hostname: 'Area2',
    ipaddress: '<SUBNET>.2',
    author: user,
  },
  {
    hostname: 'Area3',
    ipaddress: '<SUBNET>.3',
    author: user,
  },
  {
    hostname: 'Area4',
    ipaddress: '<SUBNET>.4',
    author: user,
  },
  {
    hostname: 'Area5',
    ipaddress: '<SUBNET>.5',
    author: user,
  },
  {
    hostname: 'Area6',
    ipaddress: '<SUBNET>.6',
    author: user,
  },
  {
    hostname: 'Area7',
    ipaddress: '<SUBNET>.7',
    author: user,
  },
  {
    hostname: 'Area8',
    ipaddress: '<SUBNET>.8',
    author: user,
  },
  {
    hostname: 'Area9',
    ipaddress: '<SUBNET>.9',
    author: user,
  },
  {
    hostname: 'Area10',
    ipaddress: '<SUBNET>.10',
    author: user,
  },
  {
    hostname: 'Area11',
    ipaddress: '<SUBNET>.11',
    author: user,
  },
  {
    hostname: 'Area12',
    ipaddress: '<SUBNET>.12',
    author: user,
  },
  {
    hostname: 'Area13',
    ipaddress: '<SUBNET>.13',
    author: user,
  },
  {
    hostname: 'Area14',
    ipaddress: '<SUBNET>.14',
    author: user,
  },
  {
    hostname: 'Area15',
    ipaddress: '<SUBNET>.15',
    author: user,
  },
  {
    hostname: 'Area16',
    ipaddress: '<SUBNET>.16',
    author: user,
  },
  {
    hostname: 'Area17',
    ipaddress: '<SUBNET>.17',
    author: user,
  },
  {
    hostname: 'Area18',
    ipaddress: '<SUBNET>.18',
    author: user,
  },
  {
    hostname: 'Area19',
    ipaddress: '<SUBNET>.19',
    author: user,
  },
  {
    hostname: 'Area20',
    ipaddress: '<SUBNET>.20',
    author: user,
  },
  {
    hostname: 'Area21',
    ipaddress: '<SUBNET>.21',
    author: user,
  },
  {
    hostname: 'Area22',
    ipaddress: '<SUBNET>.22',
    author: user,
  },
  {
    hostname: 'Area23',
    ipaddress: '<SUBNET>.23',
    author: user,
  },
  {
    hostname: 'Area24',
    ipaddress: '<SUBNET>.24',
    author: user,
  },
  {
    hostname: 'Area25',
    ipaddress: '<SUBNET>.25',
    author: user,
  },
  {
    hostname: 'Area26',
    ipaddress: '<SUBNET>.26',
    author: user,
  },
  {
    hostname: 'Area27',
    ipaddress: '<SUBNET>.27',
    author: user,
  },
  {
    hostname: 'Area28',
    ipaddress: '<SUBNET>.28',
    author: user,
  },
  {
    hostname: 'Area29',
    ipaddress: '<SUBNET>.29',
    author: user,
  },
  {
    hostname: 'Area30',
    ipaddress: '<SUBNET>.30',
    author: user,
  },
  {
    hostname: 'Area31',
    ipaddress: '<SUBNET>.31',
    author: user,
  },
  {
    hostname: 'Area32',
    ipaddress: '<SUBNET>.32',
    author: user,
  },
];

// never rejects
async function seedDB(aUser) {
  user = aUser;
  user = { id: aUser._id, email: aUser.email };
  // remove all devices and interfaces
  try {
    await Device.deleteMany({});
    console.log('All Devices removed');
    //remove all interfaces
    await Interface.deleteMany({});
    console.log('Removed all Interfaces successfully');
  } catch (error) {
    console.log(error);
  }

  // add a few devices and interfaces
  for (const seed of data) {
    seed.author = user;
    try {
      const createdDevice = await Device.create(seed);
      console.log('added a device');
      //add a few interfaces
      const createdInterface = await Interface.create({
        name: 'g01_' + createdDevice.hostname,
        author: user,
        device: createdDevice,
      });
      console.log('created interfaces');
      createdDevice.interfaces.push(createdInterface);
      await createdDevice.save();
    } catch (error) {
      console.log(error);
    }
  }
}
module.exports = seedDB;
