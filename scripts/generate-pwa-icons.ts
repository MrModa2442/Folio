import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

function crc32(buf: Buffer): number {
  let c = -1;
  for (let i = 0; i < buf.length; i++) {
    c = (c >>> 8) ^ crcTable[(c ^ buf[i]) & 0xff];
  }
  return (c ^ -1) >>> 0;
}

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c >>> 0;
}

function makeChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcVal = crc32(Buffer.concat([typeBuf, data]));
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crcVal, 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function generateFolioPng(size: number, maskable = false): Buffer {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const pad = maskable ? Math.round(size * 0.16) : Math.round(size * 0.1);

  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0; // filter type 0
    for (let x = 0; x < size; x++) {
      const idx = rowStart + 1 + x * 4;
      const inGreenBox = x >= pad && x < size - pad && y >= pad && y < size - pad;

      // Draw 'F' letter inside green box
      const fx = (x - pad) / (size - 2 * pad);
      const fy = (y - pad) / (size - 2 * pad);
      const isFStem = fx >= 0.32 && fx <= 0.45 && fy >= 0.24 && fy <= 0.76;
      const isFTop = fx >= 0.32 && fx <= 0.70 && fy >= 0.24 && fy <= 0.35;
      const isFMid = fx >= 0.32 && fx <= 0.62 && fy >= 0.46 && fy <= 0.56;
      const inF = inGreenBox && (isFStem || isFTop || isFMid);

      if (inF) {
        // #121212
        raw[idx] = 0x12;
        raw[idx + 1] = 0x12;
        raw[idx + 2] = 0x12;
        raw[idx + 3] = 0xff;
      } else if (inGreenBox) {
        // #1DB954
        raw[idx] = 0x1d;
        raw[idx + 1] = 0xb9;
        raw[idx + 2] = 0x54;
        raw[idx + 3] = 0xff;
      } else {
        // #121212
        raw[idx] = 0x12;
        raw[idx + 1] = 0x12;
        raw[idx + 2] = 0x12;
        raw[idx + 3] = 0xff;
      }
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlib.deflateSync(raw);
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  return Buffer.concat([
    sig,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', idat),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

const pubDir = path.resolve('public');
fs.writeFileSync(path.join(pubDir, 'apple-touch-icon.png'), generateFolioPng(180, false));
fs.writeFileSync(path.join(pubDir, 'pwa-192x192.png'), generateFolioPng(192, false));
fs.writeFileSync(path.join(pubDir, 'pwa-512x512.png'), generateFolioPng(512, false));
fs.writeFileSync(path.join(pubDir, 'pwa-maskable-512x512.png'), generateFolioPng(512, true));
console.log('Generated PWA and iPad Apple Touch PNG icons successfully.');
