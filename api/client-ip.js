/* IP del cliente para el rate limit y el audit log.
   X-Real-IP / X-Forwarded-For solo valen si la conexión viene de loopback o de una red
   privada: ahí está el nginx del contenedor web, que los pisa con la IP real (realip sobre
   CF-Connecting-IP, ver web/nginx.conf.template). Desde cualquier otro origen esos headers
   los eligió el cliente, así que se usa la IP del socket. CF-Connecting-IP no se lee.      */
import net from 'node:net';

const clean = value => String(value || '').trim().replace(/^\[|\]$/g, '').replace(/^::ffff:(?=\d+\.)/i, '');

// Loopback, RFC 1918 y ULA (fc00::/7). Más estrecho que isPrivateAddr de push-send.js a
// propósito: CGNAT (100.64/10) y similares no son "nuestro proxy".
export function isTrustedProxyAddr(addr) {
  const ip = clean(addr).toLowerCase();
  const kind = net.isIP(ip);
  if (kind === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (kind === 6) return ip === '::1' || /^f[cd][0-9a-f]{0,2}:/.test(ip);
  return false;
}

// headers: req.headers (nombres en minúscula). Devuelve null si no hay una IP válida.
export function clientIpFrom(headers, socketAddr) {
  const socketIp = clean(socketAddr);
  const candidates = isTrustedProxyAddr(socketIp)
    ? [headers['x-real-ip'], String(headers['x-forwarded-for'] || '').split(',')[0], socketIp]
    : [socketIp];
  return candidates.map(clean).find(ip => net.isIP(ip)) || null;
}
