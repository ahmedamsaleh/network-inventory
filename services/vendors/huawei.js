const generic = require('./generic');

const TWO_POW_32 = 2 ** 32;

/**
 * Huawei: some models report ifIndex values above 2^31; net-snmp decodes the
 * Integer32 column as a signed number, so they arrive negative. The OID row
 * index (the table key) is the unsigned value, so it wins.
 */
function normalizeRows(rows) {
  return rows.map((row) => {
    const reported = Number(row.ifIndex);
    if (Number.isFinite(reported) && reported < 0) {
      const fromKey = Number(row.rowKey);
      const fixed = Number.isFinite(fromKey) && fromKey >= 0 ? fromKey : reported + TWO_POW_32;
      return { ...row, ifIndex: fixed, ifIndexReported: reported };
    }
    return row;
  });
}

module.exports = {
  ...generic,
  name: 'huawei',
  enterpriseOids: ['1.3.6.1.4.1.2011'],
  keywords: ['huawei'],
  normalizeRows,
};
