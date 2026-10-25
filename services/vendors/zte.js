const generic = require('./generic');

const SATURATED_IF_SPEED = 4294967295; // ifSpeed is a 32-bit gauge: >= 4.29 Gbit/s saturates

/**
 * ZTE ifHighSpeed fix: the device either leaves ifHighSpeed at 0 while
 * ifSpeed is valid, reports it in bit/s instead of Mbit/s, or saturates
 * ifSpeed for >= 10G ports. Both values are made consistent (ifHighSpeed in
 * Mbit/s, ifSpeed in bit/s).
 */
function normalizeRows(rows) {
  return rows.map((row) => {
    let ifSpeed = Number(row.ifSpeed) || 0;
    let ifHighSpeed = Number(row.ifHighSpeed) || 0;
    if (ifHighSpeed > 1e6) {
      ifHighSpeed = Math.round(ifHighSpeed / 1e6); // reported in bit/s
    }
    if (ifHighSpeed === 0 && ifSpeed > 0 && ifSpeed < SATURATED_IF_SPEED) {
      ifHighSpeed = Math.round(ifSpeed / 1e6);
    }
    if ((ifSpeed === 0 || ifSpeed >= SATURATED_IF_SPEED) && ifHighSpeed > 0) {
      ifSpeed = ifHighSpeed * 1e6;
    }
    if (ifSpeed === row.ifSpeed && ifHighSpeed === row.ifHighSpeed) return row;
    return { ...row, ifSpeed, ifHighSpeed };
  });
}

module.exports = {
  ...generic,
  name: 'zte',
  enterpriseOids: ['1.3.6.1.4.1.3902'],
  keywords: ['zte', 'zxr10', 'zxa10'],
  normalizeRows,
};
