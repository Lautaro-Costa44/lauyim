// Renderiza web/nginx.conf.template como lo hace la imagen nginx (envsubst de las variables
// definidas) y verifica la configuración de IP real. `nginx -t` real: ver el reporte de la
// entrega; acá no hay nginx.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const template = fs.readFileSync(fileURLToPath(new URL('../web/nginx.conf.template', import.meta.url)), 'utf8');
const env = { NGINX_PORT: '80', BACKEND: 'api', PORT: '3000' };
const rendered = template.replace(/\$\{(\w+)\}/g, (m, name) => (name in env ? env[name] : m));
const directives = rendered.split('\n').map(l => l.replace(/#.*/, '').trim()).filter(Boolean);

test('el template solo usa las variables que define la imagen', () => {
  assert.deepEqual([...template.matchAll(/\$\{(\w+)\}/g)].map(m => m[1]).filter(n => !(n in env)), []);
  assert.ok(!/CF_CONNECTING_IP/.test(template));
});

test('realip: confía en CF-Connecting-IP solo desde loopback y la red docker', () => {
  assert.ok(directives.includes('set_real_ip_from 127.0.0.1;'));
  assert.ok(directives.includes('set_real_ip_from 172.16.0.0/12;'));
  assert.ok(directives.includes('real_ip_header CF-Connecting-IP;'));
  assert.deepEqual(directives.filter(d => d.startsWith('set_real_ip_from')).length, 2);
});

test('/api recibe la IP real en X-Real-IP / X-Forwarded-For y no recibe CF-Connecting-IP', () => {
  assert.ok(directives.includes('proxy_set_header X-Real-IP $remote_addr;'));
  assert.ok(directives.includes('proxy_set_header X-Forwarded-For $remote_addr;'));
  assert.ok(directives.includes('proxy_set_header CF-Connecting-IP "";'));
  assert.ok(directives.includes('proxy_pass http://api:3000;'));
});
