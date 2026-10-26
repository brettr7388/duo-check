import test from 'node:test';
import assert from 'node:assert/strict';
import { checkUrlLiteral, checkUrlResolved, isBlockedIp, parseIPv6, normalizeUrl } from '../src/ssrf.js';

const bad = (s) => assert.equal(checkUrlLiteral(s).ok, false, `should block ${s}`);
const good = (s) => assert.equal(checkUrlLiteral(s).ok, true, `should allow ${s}`);

test('allows normal public sites, with or without scheme', () => {
  good('example.com'); good('https://example.com'); good('http://news.ycombinator.com/item?id=1'); good('  en.wikipedia.org/wiki/Foldable_phone  ');
  good('http://8.8.8.8'); good('https://[2606:4700:4700::1111]/');
});

test('blocks localhost and private suffixes', () => {
  ['localhost', 'http://localhost/', 'http://foo.localhost', 'printer.local', 'db.internal', 'http://intranet', 'http://router.home.arpa'].forEach(bad);
});

test('blocks private, loopback, link-local and metadata IPv4, including sneaky encodings', () => {
  ['http://127.0.0.1', 'http://127.1', 'http://2130706433', 'http://0x7f.0.0.1', 'http://0177.0.0.1', 'http://10.0.0.5', 'http://172.16.0.1', 'http://172.31.255.255',
    'http://192.168.1.1', 'http://169.254.169.254/latest/meta-data', 'http://100.64.0.1', 'http://0.0.0.0', 'http://255.255.255.255', 'http://224.0.0.1', 'http://198.18.0.1'].forEach(bad);
  good('http://172.32.0.1'); good('http://11.0.0.1');
});

test('blocks private IPv6 and IPv4 hidden inside IPv6', () => {
  ['http://[::1]/', 'http://[::]/', 'http://[fe80::1]/', 'http://[fc00::1]/', 'http://[fd12:3456::1]/', 'http://[::ffff:127.0.0.1]/', 'http://[::ffff:7f00:1]/',
    'http://[::ffff:169.254.169.254]/', 'http://[64:ff9b::7f00:1]/', 'http://[2002:7f00:1::]/', 'http://[ff02::1]/', 'http://[2001:db8::1]/'].forEach(bad);
  assert.equal(isBlockedIp('2606:4700:4700::1111'), false);
  assert.deepEqual(parseIPv6('::1'), [0, 0, 0, 0, 0, 0, 0, 1]);
});

test('blocks non-http schemes, credentials, odd ports, junk', () => {
  ['ftp://example.com', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,hi', 'gopher://example.com', 'http://user:pw@example.com', 'http://user@example.com',
    'http://example.com:8080', 'https://example.com:22', 'http://example.com:80x', '', '   ', 'not a url', 'http://', 'http://nodots', 'a'.repeat(3000)].forEach(bad);
  assert.equal(checkUrlLiteral(undefined).ok, false); assert.equal(checkUrlLiteral(42).ok, false);
  good('http://example.com:80'); good('https://example.com:443');
});

test('DNS check: refuses names that resolve to private space, fails closed on lookup error', async () => {
  const mk = (ips) => async () => ips;
  assert.equal((await checkUrlResolved('example.com', mk(['93.184.216.34']))).ok, true);
  assert.equal((await checkUrlResolved('evil.example.com', mk(['10.0.0.9']))).ok, false);
  assert.equal((await checkUrlResolved('evil.example.com', mk(['93.184.216.34', '127.0.0.1']))).ok, false);
  assert.equal((await checkUrlResolved('evil.example.com', mk(['::1']))).ok, false);
  assert.equal((await checkUrlResolved('nope.example.com', mk([]))).ok, false);
  assert.equal((await checkUrlResolved('example.com', async () => { throw new Error('boom'); })).ok, false);
  assert.equal((await checkUrlResolved('http://127.0.0.1', mk(['8.8.8.8']))).ok, false); // literal wins, resolver ignored
});

test('normalizeUrl: stable cache input', () => {
  const n = (s) => normalizeUrl(checkUrlLiteral(s).url);
  assert.equal(n('Example.COM'), 'https://example.com/');
  assert.equal(n('https://example.com#frag'), n('https://example.com/'));
  assert.equal(n('https://example.com:443/a'), 'https://example.com/a');
  assert.notEqual(n('https://example.com/?a=1'), n('https://example.com/'));
});
