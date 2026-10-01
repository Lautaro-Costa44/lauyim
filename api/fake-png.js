// Solo para tests (branding): un PNG válido mínimo, o uno del peor caso.
import crypto from 'node:crypto';
import zlib from 'node:zlib';

// PNG válido de side×side. Por defecto, un solo color (pesa casi nada). Con { noise: true }, RGBA
// con ruido: no se comprime, es lo máximo que puede pesar un ícono de ese lado (una foto se acerca).
export function fakePng(side, { noise = false } = {}) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(side, 0); ihdr.writeUInt32BE(side, 4); ihdr[8] = 8; ihdr[9] = noise ? 6 : 2;
  const row = () => Buffer.concat([Buffer.from([0]), noise ? crypto.randomBytes(side * 4) : Buffer.alloc(side * 3, 200)]);
  const raw = Buffer.concat(Array.from({ length: side }, row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
