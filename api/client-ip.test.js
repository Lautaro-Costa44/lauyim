import test from 'node:test';
import assert from 'node:assert/strict';
import { clientIpFrom, isTrustedProxyAddr } from './client-ip.js';

const forged = { 'x-real-ip': '1.2.3.4', 'x-forwarded-for': '5.6.7.8, 9.9.9.9', 'cf-connecting-ip': '7.7.7.7' };

test('socket público: los headers se ignoran y vale la IP del socket', () => {
  assert.equal(clientIpFrom(forged, '181.10.20.30'), '181.10.20.30');
  assert.equal(clientIpFrom(forged, '::ffff:181.10.20.30'), '181.10.20.30');
  assert.equal(clientIpFrom(forged, '2800:810::1'), '2800:810::1');
  assert.equal(clientIpFrom(forged, '100.64.0.1'), '100.64.0.1');   // CGNAT no es nuestro proxy
});

test('socket privado o loopback: X-Real-IP, si no la primera de X-Forwarded-For', () => {
  for (const peer of ['172.20.0.3', '::ffff:172.18.0.5', '10.0.0.2', '192.168.1.9', '127.0.0.1', '::1', 'fd00::5']) {
    assert.equal(clientIpFrom(forged, peer), '1.2.3.4', peer);
  }
  assert.equal(clientIpFrom({ 'x-forwarded-for': '5.6.7.8, 9.9.9.9' }, '172.20.0.3'), '5.6.7.8');
  assert.equal(clientIpFrom({}, '172.20.0.3'), '172.20.0.3');
});

test('CF-Connecting-IP no se usa nunca', () => {
  assert.equal(clientIpFrom({ 'cf-connecting-ip': '7.7.7.7' }, '172.20.0.3'), '172.20.0.3');
  assert.equal(clientIpFrom({ 'cf-connecting-ip': '7.7.7.7' }, '181.10.20.30'), '181.10.20.30');
});

test('valores inválidos: header basura cae al socket; sin nada, null', () => {
  assert.equal(clientIpFrom({ 'x-real-ip': 'no-soy-ip' }, '172.20.0.3'), '172.20.0.3');
  assert.equal(clientIpFrom({}, undefined), null);
  assert.equal(clientIpFrom({ 'x-real-ip': '[2800:810::1]' }, '172.20.0.3'), '2800:810::1');
});

test('isTrustedProxyAddr: bordes de 172.16.0.0/12', () => {
  assert.equal(isTrustedProxyAddr('172.16.0.1'), true);
  assert.equal(isTrustedProxyAddr('172.31.255.255'), true);
  assert.equal(isTrustedProxyAddr('172.15.0.1'), false);
  assert.equal(isTrustedProxyAddr('172.32.0.1'), false);
});
