/**
 * Unit tests for middleware/parser/parser.js (pure functions, no database).
 * The expectations come from the alias samples and delimiter rules.
 */
const parser = require('../middleware/parser/parser');

const {
  parseIfAlias,
  parseSpeedToken,
  parseSpeed,
  formatSpeed,
  speedCategory,
  linkInfoFromLink,
  parseHostname,
} = parser;

/** non-default fields of a parse result */
function extracted(result) {
  const out = {};
  for (const key of Object.keys(parser.emptyFields())) {
    if (result[key] !== '' && result[key] !== 0) out[key] = result[key];
  }
  return out;
}

describe('parseIfAlias – samples', () => {
  test('1. INT- (International, 11 tokens)', () => {
    const r = parseIfAlias('INT-IPT-Cogent-DUB-10GIG-B2-NB-L22-1_300050661-EIG_IPT_10G_0019-EIG');
    expect(r.pattern).toBe('International');
    expect(r.link.specialService).toBe('International');
    expect(r.unknownFlag).toBe(0);
    expect(extracted(r)).toEqual({
      service: 'IPT',
      provider: 'Cogent',
      termination: 'DUB',
      speedToken: '10GIG',
      speed: 10e9,
      bundleId: 'B2',
      connType: 'NB',
      linkNumber: 'L22',
      CID: '1_300050661',
      BTCID: 'EIG_IPT_10G_0019',
      subCable: 'EIG',
    });
    expect(r.sp_speedText).toBe('10 Gbps');
    expect(r.link.label).toBe('International Cogent L22 10 Gbps');
  });

  test('2. Cache- (8 tokens, trailing "-" ignored)', () => {
    const r = parseIfAlias('Cache-Facebook-WIK-10G-NB-L11-CID_5688980-SVDC-');
    expect(r.pattern).toBe('Cache');
    expect(r.unknownFlag).toBe(0);
    expect(extracted(r)).toEqual({
      provider: 'Facebook',
      node: 'WIK',
      pop: 'WIK',
      speedToken: '10G',
      speed: 10e9,
      bundleId: 'NB',
      linkNumber: 'L11',
      CID: 'CID_5688980',
      serverNumber: 'SVDC',
    });
  });

  test('3. -ALPHA/-HS/-LTE/-ESP-BITSTREAM (5 tokens)', () => {
    const alpha = parseIfAlias('THREE-ALPHA-BITSTREAM L1 GIG');
    expect(alpha.pattern).toBe('Bitstream');
    expect(extracted(alpha)).toEqual({
      customer: 'THREE',
      serviceType: 'ALPHA',
      linkNumber: 'L1',
      speedToken: 'GIG',
      speed: 1e9,
    });
    const esp = parseIfAlias('LYCKA-ESP-BITSTREAM B1 2GIG');
    expect(esp.pattern).toBe('Bitstream'); // bitstream wins over the ESP- prefix rule (not a prefix here)
    expect(extracted(esp)).toEqual({
      customer: 'LYCKA',
      serviceType: 'ESP',
      linkNumber: 'B1',
      speedToken: '2GIG',
      speed: 2e9,
    });
    for (const alias of ['X-HS-BITSTREAM L2 100M', 'X-LTE-BITSTREAM L3 1G']) {
      expect(parseIfAlias(alias).serviceType).toBe(alias.split('-')[1]);
    }
  });

  test('4. -BITSTREAM (4 tokens)', () => {
    const r = parseIfAlias('THREE-BITSTREAM L6 1GIG');
    expect(r.pattern).toBe('Bitstream');
    expect(extracted(r)).toEqual({
      customer: 'THREE',
      linkNumber: 'L6',
      speedToken: '1GIG',
      speed: 1e9,
    });
    expect(r.sp_speedText).toBe('1 Gbps');
  });

  test('5. ESP- (6 tokens)', () => {
    const r = parseIfAlias('ESP-BT_ACCESS-TEMPLEBAR-INT-1-100');
    expect(r.pattern).toBe('ESP');
    expect(extracted(r)).toEqual({
      customer: 'BT_ACCESS',
      pop: 'TEMPLEBAR',
      connType: 'INT',
      emsOrder: '1',
      connectedBW: '100',
      speedToken: '100',
      speed: 100e6, // bare number -> Mbit/s
    });
    expect(r.sp_speedText).toBe('100 Mbps');
  });

  test('6. firewall (-FW, 7 tokens after _ and space normalisation)', () => {
    const r = parseIfAlias('ONGAR_GI_Trust_IPv4-FW02E-C-IR');
    expect(r.pattern).toBe('Firewall');
    expect(r.fieldCount).toBe(7);
    expect(extracted(r)).toEqual({
      pop: 'ONGAR',
      serviceType: 'Trust',
      ipType: 'IPv4',
      fwType: 'FW02',
      vendor: 'E',
    });
    expect(r.sp_speedText).toBe('Unknown'); // no speed field in this pattern
    expect(parseIfAlias('DUBLIN_GI_Untrust_IPv6-FW01C-C-IR').pattern).toBe('Firewall');
  });

  test('7. NR_ (10 tokens)', () => {
    const r = parseIfAlias('NR_Lycka_Data_ALZ_AUTO-N01E-DSR-IR L1 GIG');
    expect(r.pattern).toBe('NR');
    expect(extracted(r)).toEqual({
      provider: 'Lycka',
      service: 'Data',
      sourceCore: 'ALZ',
      destinationCore: 'AUTO',
      vendor: 'E',
      linkNumber: 'L1',
      speedToken: 'GIG',
      speed: 1e9,
    });
  });

  test('8. _ENB_ (LTE, 8 tokens)', () => {
    const r = parseIfAlias('STELORGAN_ENB_LDubG31109-E01N-D-IR L1 GIG');
    expect(r.pattern).toBe('LTE');
    expect(extracted(r)).toEqual({
      pop: 'STELORGAN',
      siteCode: 'LDubG31109',
      vendor: 'N',
      linkNumber: 'L1',
      speedToken: 'GIG',
      speed: 1e9,
    });
  });

  test('9. EPC (space separated, 4 tokens)', () => {
    const r = parseIfAlias('Ericson EPC L1 10GIG');
    expect(r.pattern).toBe('EPC');
    expect(extracted(r)).toEqual({
      provider: 'Ericson',
      serviceType: 'EPC',
      linkNumber: 'L1',
      speedToken: '10GIG',
      speed: 10e9,
    });
  });

  test('10. pre1 (DPI, 3 tokens)', () => {
    const r = parseIfAlias('CENTRA2-PRE1-1/1/INT');
    expect(r.pattern).toBe('DPI');
    expect(extracted(r)).toEqual({
      pop: 'CENTRA2',
      dpiName: 'CENTRA2',
      preNumber: '1',
      portID: '1/1/INT',
    });
  });
});

describe('parseIfAlias – rules', () => {
  test('matching is case-insensitive and the alias is trimmed; values keep their case', () => {
    const r = parseIfAlias(
      '  int-ipt-cogent-dub-10gig-b2-nb-l22-1_300050661-eig_ipt_10g_0019-eig  '
    );
    expect(r.pattern).toBe('International');
    expect(r.provider).toBe('cogent');
    expect(r.alias).toBe('int-ipt-cogent-dub-10gig-b2-nb-l22-1_300050661-eig_ipt_10g_0019-eig');
    expect(parseIfAlias('cache-X-Y-1G-NB-L1-CID_1-SVDC').pattern).toBe('Cache');
    expect(parseIfAlias('three-bitstream l6 1gig').customer).toBe('three');
    expect(parseIfAlias('ericson epc l1 10gig').pattern).toBe('EPC');
    expect(parseIfAlias('centra2-pre1-1/1/int').preNumber).toBe('1');
  });

  test('first match wins, INT- first', () => {
    // contains -FW and -IR, NR_, _ENB_, EPC, pre1 and BITSTREAM but starts with INT-
    expect(parseIfAlias('INT-NR_X-_ENB_-EPC-PRE1-BITSTREAM-FW-IR').pattern).toBe('International');
    expect(parseIfAlias('Cache-X-EPC-1G-NB-L1-CID-SV').pattern).toBe('Cache');
    expect(parseIfAlias('ESP-X-POP-INT-1-100 EPC').pattern).toBe('ESP');
    expect(parseIfAlias('NR_X_Y_Z_W-N01E-A-B L1 GIG EPC').pattern).toBe('NR');
  });

  test('a wrong field count sets unknownFlag and leaves the fields at their defaults', () => {
    const r = parseIfAlias('INT-IPT-Cogent-DUB');
    expect(r.pattern).toBe('International');
    expect(r.unknownFlag).toBe(1);
    expect(r.fieldCount).toBe(4);
    expect(extracted(r)).toEqual({});
    expect(r.speed).toBe(0);
    expect(r.sp_speedText).toBe('Unknown');
    expect(r.link.specialService).toBe('International');
    expect(parseIfAlias('Ericson EPC L1').unknownFlag).toBe(1);
    expect(parseIfAlias('THREE-BITSTREAM L6 1GIG extra').unknownFlag).toBe(1);
  });

  test('unmatched aliases yield pattern "" and the defaults', () => {
    for (const alias of ['uplink to core', 'ge-0/0/0', 'customer link', '---', 'x']) {
      const r = parseIfAlias(alias);
      expect(r.pattern).toBe('');
      expect(r.unknownFlag).toBe(0);
      expect(extracted(r)).toEqual({});
      expect(r.link).toEqual(parser.emptyLink());
    }
  });

  test('never throws: empty, null, undefined, numbers, objects, buffers', () => {
    for (const input of [
      '',
      '   ',
      null,
      undefined,
      0,
      42,
      {},
      [],
      true,
      Buffer.from('INT-a-b'),
      () => {},
    ]) {
      expect(() => parseIfAlias(input)).not.toThrow();
    }
    expect(parseIfAlias(undefined).sp_speedText).toBe('Unknown');
    expect(parseIfAlias(Buffer.from('THREE-BITSTREAM L6 1GIG')).customer).toBe('THREE');
    const defaults = parseIfAlias(null);
    for (const value of Object.values(parser.emptyFields())) expect([0, '']).toContain(value);
    expect(defaults.speed).toBe(0);
  });
});

describe('parseSpeedToken', () => {
  test.each([
    ['1G', 1e9],
    ['10GIG', 10e9],
    ['GIG', 1e9],
    ['gig', 1e9],
    ['2GIG', 2e9],
    ['10G', 10e9],
    ['100M', 100e6],
    ['155', 155e6],
    ['0.5G', 0.5e9],
    ['512K', 512e3],
    ['', 0],
    ['Unknown', 0],
    ['0', 0],
    ['abc', 0],
    ['10GE', 0],
    [null, 0],
    [undefined, 0],
    [{}, 0],
  ])('%p -> %p bit/s', (token, expected) => {
    expect(parseSpeedToken(token)).toBe(expected);
  });
});

describe('parseSpeed / formatSpeed / speedCategory', () => {
  test('formats bit/s values, "Unknown" for 0/invalid', () => {
    expect(formatSpeed(10e9)).toBe('10 Gbps');
    expect(formatSpeed(155e6)).toBe('155 Mbps');
    expect(formatSpeed(512e3)).toBe('512 Kbps');
    expect(formatSpeed(2.5e9)).toBe('2.5 Gbps');
    expect(formatSpeed(0)).toBe('Unknown');
    expect(formatSpeed(-1)).toBe('Unknown');
    expect(formatSpeed('x')).toBe('Unknown');
  });

  test('produces the four texts and the category from the best known speed', () => {
    const r = parseSpeed({ ifSpeed: 1e9, ifHighSpeed: 10000, sp_speed: '10GIG', actualspeed: 0 });
    expect(r).toEqual({
      ifSpeedText: '1 Gbps',
      ifHighSpeedText: '10 Gbps', // ifHighSpeed is in Mbit/s
      sp_speedText: '10 Gbps',
      actualspeedText: 'Unknown',
      speedCat: '10G',
    });
    expect(parseSpeed({}).speedCat).toBe('Unknown');
    expect(parseSpeed({ actualspeed: 100e6, ifSpeed: 1e9 }).speedCat).toBe('100M'); // actual wins
    expect(parseSpeed(null)).toEqual({
      ifSpeedText: 'Unknown',
      ifHighSpeedText: 'Unknown',
      sp_speedText: 'Unknown',
      actualspeedText: 'Unknown',
      speedCat: 'Unknown',
    });
    expect(parseSpeed({ ifSpeed: '155000000' }).ifSpeedText).toBe('155 Mbps'); // numeric strings are bit/s
  });

  test.each([
    [0, 'Unknown'],
    [64e3, '<100M'],
    [100e6, '100M'],
    [155e6, '100M'],
    [1e9, '1G'],
    [2e9, '1G'],
    [10e9, '10G'],
    [40e9, '40G'],
    [100e9, '100G+'],
    [400e9, '100G+'],
  ])('speedCategory(%p) = %p', (bps, category) => {
    expect(speedCategory(bps)).toBe(category);
  });
});

describe('linkInfoFromLink', () => {
  const link = {
    device1: 'DUBP-RCJ1-DUB-01',
    interface1: 'ge-0/0/0',
    device2: 'CORP-RCJ1-COR-01',
    interface2: 'ge-0/0/1',
  };

  test('describes the other end of the link from either side', () => {
    expect(linkInfoFromLink(link, 'DUBP-RCJ1-DUB-01')).toEqual({
      type: 'WAN',
      secondPOP: 'CORP',
      secondHost: 'CORP-RCJ1-COR-01',
      secondInterface: 'ge-0/0/1',
      label: 'Link to CORP-RCJ1-COR-01 ge-0/0/1',
      specialService: '',
    });
    const fromOtherSide = linkInfoFromLink(link, 'corp-rcj1-cor-01');
    expect(fromOtherSide.secondHost).toBe('DUBP-RCJ1-DUB-01');
    expect(fromOtherSide.secondInterface).toBe('ge-0/0/0');
  });

  test('same POP on both ends is Local; unknown naming leaves the type empty', () => {
    const local = linkInfoFromLink(
      {
        device1: 'DUBP-RCJ1-DUB-01',
        device2: 'DUBP-RCJ2-DUB-02',
        interface1: 'a',
        interface2: 'b',
      },
      'DUBP-RCJ1-DUB-01'
    );
    expect(local.type).toBe('Local');
    const unknown = linkInfoFromLink(
      { device1: 'router-a', device2: 'router-b', interface1: 'a', interface2: 'b' },
      'router-a'
    );
    expect(unknown).toMatchObject({ type: '', secondHost: 'router-b', secondPOP: '' });
  });

  test('never throws', () => {
    for (const input of [null, undefined, {}, 'x', 5, { device1: null }]) {
      expect(() => linkInfoFromLink(input, 'h')).not.toThrow();
      expect(linkInfoFromLink(input, 'h')).toEqual(parser.emptyLink());
    }
  });
});

describe('parseHostname', () => {
  test('applies the <POP>-<TYPE><NN><VENDOR>-<CTY>-<n> rule', () => {
    const lookups = { deviceType: { R: 'Router' }, deviceVendor: { J: 'Juniper' } };
    expect(parseHostname('DUBP-RCJ1-DUB-01', lookups)).toEqual({
      popName: 'DUBP',
      popCty: 'DUB',
      deviceType: 'Router',
      deviceVendor: undefined, // 4th char is "1"
    });
    expect(parseHostname('DUBP-RCJ1-DUB-01').popName).toBe('DUBP'); // default lookups
    expect(parseHostname('router-001')).toBeNull();
    expect(parseHostname('A-B-C-D-E')).toBeNull();
    expect(parseHostname('A-TOOLONG-C-D')).toBeNull();
    for (const input of ['', null, undefined, 42, {}]) expect(parseHostname(input)).toBeNull();
  });
});
