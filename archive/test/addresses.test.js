// §13.5's address rule, tested exhaustively because it is the part of the fetch layer where
// a miss is a vulnerability rather than a bug, and the part that needs no socket to test.

import test from 'node:test';
import assert from 'node:assert/strict';

import { isPublicAddress, parseIPv4, parseIPv6 } from '../src/index.js';

const BLOCKED = [
  // loopback
  '127.0.0.1', '127.1.2.3', '127.255.255.254', '::1', '0:0:0:0:0:0:0:1',
  // private (RFC 1918)
  '10.0.0.1', '10.255.255.255', '172.16.0.1', '172.31.255.255', '192.168.0.1', '192.168.255.255',
  // link-local, and the cloud metadata address that lives there
  '169.254.0.1', '169.254.169.254', 'fe80::1', 'febf:ffff::1',
  // unique local
  'fc00::1', 'fd00:1234::abcd',
  // unspecified / this-network
  '0.0.0.0', '::', '0.0.0.7',
  // carrier-grade NAT
  '100.64.0.1', '100.127.255.255',
  // multicast and reserved
  '224.0.0.1', '239.255.255.255', '240.0.0.1', '255.255.255.255', 'ff02::1',
  // documentation and benchmarking ranges
  '192.0.2.1', '198.51.100.1', '203.0.113.1', '198.18.0.1', '192.0.0.1', '2001:db8::1',
  // embedded IPv4 forms that reach a blocked address through an IPv6 literal
  '::ffff:127.0.0.1', '::ffff:169.254.169.254', '::ffff:10.0.0.1',
  '::127.0.0.1', '64:ff9b::127.0.0.1', '64:ff9b::7f00:1', '2002:7f00:0001::',
  '2002:a9fe:a9fe::',
];

const ALLOWED = [
  '1.1.1.1', '8.8.8.8', '93.184.216.34', '172.15.255.255', '172.32.0.1', '192.169.0.1',
  '100.63.255.255', '100.128.0.1', '11.0.0.1', '126.255.255.255', '128.0.0.1',
  '2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:1.1.1.1', '2002:0808:0808::',
];

test('addresses that must never be connected to are refused', () => {
  for (const address of BLOCKED) {
    assert.equal(isPublicAddress(address), false, `${address} should be blocked`);
  }
});

test('ordinary public addresses are allowed', () => {
  for (const address of ALLOWED) {
    assert.equal(isPublicAddress(address), true, `${address} should be allowed`);
  }
});

test('boundaries of each blocked range are exact', () => {
  // Off-by-one in a CIDR mask silently opens or closes a whole /8, and neither direction
  // announces itself.
  const edges = [
    ['9.255.255.255', true], ['10.0.0.0', false], ['10.255.255.255', false], ['11.0.0.0', true],
    ['172.15.255.255', true], ['172.16.0.0', false], ['172.31.255.255', false], ['172.32.0.0', true],
    ['192.167.255.255', true], ['192.168.0.0', false], ['192.168.255.255', false], ['192.169.0.0', true],
    ['169.253.255.255', true], ['169.254.0.0', false], ['169.254.255.255', false], ['169.255.0.0', true],
    ['100.63.255.255', true], ['100.64.0.0', false], ['100.127.255.255', false], ['100.128.0.0', true],
    ['126.255.255.255', true], ['127.0.0.0', false], ['127.255.255.255', false], ['128.0.0.0', true],
    ['223.255.255.255', true], ['224.0.0.0', false],
  ];
  for (const [address, expected] of edges) {
    assert.equal(isPublicAddress(address), expected, `${address}`);
  }
});

test('addresses that are not addresses are refused', () => {
  // A parser that returns null on garbage must fail closed, not open.
  for (const junk of ['', 'example.com', 'not an ip', '1.2.3', '1.2.3.4.5', '256.1.1.1',
    '1.2.3.-1', '::gggg', 'fe80::1::2', '1.2.3.4:80', null, undefined, {}, 12345]) {
    assert.equal(isPublicAddress(junk), false, `${JSON.stringify(junk)} should be refused`);
  }
});

test('octal-looking dotted quads are refused rather than guessed at', () => {
  // Resolvers disagree about whether 0177.0.0.1 is octal; the disagreement is the bypass.
  for (const address of ['0177.0.0.1', '010.0.0.1', '127.00.0.1', '0x7f.0.0.1', '2130706433']) {
    assert.equal(parseIPv4(address), null, `${address} should not parse`);
    assert.equal(isPublicAddress(address), false, `${address} should be refused`);
  }
});

test('the IPv6 parser round-trips the forms it accepts', () => {
  assert.deepEqual(parseIPv6('::1'), [0, 0, 0, 0, 0, 0, 0, 1]);
  assert.deepEqual(parseIPv6('::'), [0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(parseIPv6('fe80::1'), [0xfe80, 0, 0, 0, 0, 0, 0, 1]);
  assert.deepEqual(parseIPv6('::ffff:127.0.0.1'), [0, 0, 0, 0, 0, 0xffff, 0x7f00, 1]);
  assert.deepEqual(parseIPv6('2606:4700:4700::1111'), [0x2606, 0x4700, 0x4700, 0, 0, 0, 0, 0x1111]);
  assert.deepEqual(parseIPv6('fe80::1%eth0'), [0xfe80, 0, 0, 0, 0, 0, 0, 1]); // zone id stripped
  assert.deepEqual(parseIPv6('1:2:3:4:5:6:7:8'), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(parseIPv6('1:2:3:4:5:6:1.2.3.4'), [1, 2, 3, 4, 5, 6, 0x0102, 0x0304]);
});
