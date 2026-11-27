// O-128: placeholder app icons ("HSE" on the theme colour) until brand assets are supplied.
// Writes public/icons/*.png without any image library: a tiny PNG encoder over zlib.
// Run once with `node scripts/make-icons.mjs`; the output is committed.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'icons');
mkdirSync(out, { recursive: true });

const THEME = [0x1d, 0x4e, 0xd8];
const WHITE = [0xff, 0xff, 0xff];

// 5 × 7 glyphs.
const GLYPHS = {
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
};

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** `safeZone`: share of the size the letters may use (maskable icons keep a margin). */
function icon(size, safeZone) {
  const pixels = Array.from({ length: size }, () => Array.from({ length: size }, () => THEME));
  const text = 'HSE';
  const columns = text.length * 5 + (text.length - 1); // one blank column between letters
  const scale = Math.floor((size * safeZone) / columns);
  const width = columns * scale;
  const height = 7 * scale;
  const left = Math.floor((size - width) / 2);
  const top = Math.floor((size - height) / 2);
  [...text].forEach((letter, index) => {
    GLYPHS[letter].forEach((row, y) => {
      [...row].forEach((bit, x) => {
        if (bit !== '1') return;
        for (let dy = 0; dy < scale; dy += 1) {
          for (let dx = 0; dx < scale; dx += 1) {
            pixels[top + y * scale + dy][left + (index * 6 + x) * scale + dx] = WHITE;
          }
        }
      });
    });
  });
  const raw = Buffer.alloc(size * (size * 3 + 1));
  let offset = 0;
  for (const row of pixels) {
    raw[offset] = 0;
    offset += 1;
    for (const [r, g, b] of row) {
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      offset += 3;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const files = {
  'icon-192.png': icon(192, 0.7),
  'icon-512.png': icon(512, 0.7),
  'icon-maskable-512.png': icon(512, 0.5),
  'apple-touch-icon.png': icon(180, 0.7),
};
for (const [name, data] of Object.entries(files)) writeFileSync(join(out, name), data);
console.log(`icons written to public/icons: ${Object.keys(files).join(', ')}`);
