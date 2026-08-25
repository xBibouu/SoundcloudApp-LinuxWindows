const fs = require('fs');

const WAL_HEADER_SIZE = 32;
const FRAME_HEADER_SIZE = 24;
const MAGIC = [0x377f0682, 0x377f0683];

function applyWal(dbBuffer, wal) {
  if (typeof wal === 'string') {
    try {
      wal = fs.readFileSync(wal);
    } catch {
      return dbBuffer;
    }
  }
  if (!wal || wal.length < WAL_HEADER_SIZE) return dbBuffer;

  const magic = wal.readUInt32BE(0);
  if (!MAGIC.includes(magic)) return dbBuffer;

  const pageSize = wal.readUInt32BE(8);
  if (!pageSize || pageSize & (pageSize - 1)) return dbBuffer;

  const salt1 = wal.readUInt32BE(16);
  const salt2 = wal.readUInt32BE(20);

  const frames = [];
  let lastCommit = -1;

  for (
    let offset = WAL_HEADER_SIZE;
    offset + FRAME_HEADER_SIZE + pageSize <= wal.length;
    offset += FRAME_HEADER_SIZE + pageSize
  ) {
    if (wal.readUInt32BE(offset + 8) !== salt1 || wal.readUInt32BE(offset + 12) !== salt2) {
      break;
    }
    const pageNumber = wal.readUInt32BE(offset);
    const dbSizeAfter = wal.readUInt32BE(offset + 4);
    frames.push({ pageNumber, dbSizeAfter, dataOffset: offset + FRAME_HEADER_SIZE });
    if (dbSizeAfter > 0) lastCommit = frames.length - 1;
  }

  if (lastCommit < 0) return dbBuffer;

  const finalPages = frames[lastCommit].dbSizeAfter;
  let out = dbBuffer;
  const needed = finalPages * pageSize;
  if (out.length < needed) {
    out = Buffer.concat([out, Buffer.alloc(needed - out.length)]);
  } else if (out.length > needed) {
    out = out.subarray(0, needed);
  } else {
    out = Buffer.from(out);
  }

  for (let i = 0; i <= lastCommit; i++) {
    const { pageNumber, dataOffset } = frames[i];
    const target = (pageNumber - 1) * pageSize;
    if (target + pageSize > out.length) continue;
    wal.copy(out, target, dataOffset, dataOffset + pageSize);
  }

  return out;
}

module.exports = { applyWal };
