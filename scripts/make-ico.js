const fs = require('fs');
const path = require('path');

const SIZES = [16, 32, 48, 64, 128, 256];
const ICONS = path.join(__dirname, '..', 'build', 'icons');
const OUT = path.join(__dirname, '..', 'build', 'icon.ico');

const images = SIZES.map((size) => ({
  size,
  data: fs.readFileSync(path.join(ICONS, `${size}x${size}.png`))
}));

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);

const directory = Buffer.alloc(16 * images.length);
let offset = header.length + directory.length;

images.forEach((image, index) => {
  const entry = index * 16;
  directory[entry] = image.size >= 256 ? 0 : image.size;
  directory[entry + 1] = image.size >= 256 ? 0 : image.size;
  directory[entry + 2] = 0;
  directory[entry + 3] = 0;
  directory.writeUInt16LE(1, entry + 4);
  directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(image.data.length, entry + 8);
  directory.writeUInt32LE(offset, entry + 12);
  offset += image.data.length;
});

fs.writeFileSync(OUT, Buffer.concat([header, directory, ...images.map((i) => i.data)]));
console.log('wrote', path.relative(process.cwd(), OUT), `(${images.length} sizes)`);
