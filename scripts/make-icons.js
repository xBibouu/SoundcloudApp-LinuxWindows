const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZES = [16, 22, 24, 32, 48, 64, 128, 256, 512];
const OUT = path.join(__dirname, '..', 'build', 'icons');

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const BARS = [0.34, 0.52, 0.74, 0.95, 0.78, 0.58, 0.86, 1.0, 0.66, 0.42];

function draw(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const radius = size * 0.22;
  const pad = size * 0.16;
  const barArea = size - pad * 2;
  const barSlot = barArea / BARS.length;
  const barWidth = barSlot * 0.52;
  const centerY = size / 2;

  const inRounded = (x, y) => {
    const cx = Math.min(Math.max(x, radius), size - radius);
    const cy = Math.min(Math.max(y, radius), size - radius);
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= radius * radius;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (!inRounded(x + 0.5, y + 0.5)) continue;

      const t = y / size;
      let r = Math.round(255 - 0 * t);
      let g = Math.round(126 - 66 * t);
      let b = Math.round(20 - 20 * t);
      let a = 255;

      for (let n = 0; n < BARS.length; n++) {
        const bx = pad + n * barSlot + (barSlot - barWidth) / 2;
        if (x + 0.5 >= bx && x + 0.5 <= bx + barWidth) {
          const half = (BARS[n] * barArea) / 2;
          if (Math.abs(y + 0.5 - centerY) <= half) {
            r = g = b = 255;
          }
        }
      }

      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = a;
    }
  }
  return rgba;
}

fs.mkdirSync(OUT, { recursive: true });
for (const size of SIZES) {
  const file = path.join(OUT, `${size}x${size}.png`);
  fs.writeFileSync(file, encodePng(size, size, draw(size)));
  console.log('wrote', path.relative(process.cwd(), file));
}
