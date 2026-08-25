const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIST = path.join(__dirname, '..', 'dist');
const PRODUCT = require('../package.json').productName;
const VERSION = require('../package.json').version;
const OUT = path.join(DIST, `${PRODUCT}-${VERSION}-SHA256SUMS`);

const EXTENSIONS = ['.AppImage', '.deb', '.rpm', '.flatpak', '.exe', '.zsync'];

const files = fs
  .readdirSync(DIST)
  .filter((name) => EXTENSIONS.includes(path.extname(name)))
  .sort();

if (!files.length) {
  console.error('no artifacts in dist/');
  process.exit(1);
}

const lines = files.map((name) => {
  const hash = crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(DIST, name)))
    .digest('hex');
  return `${hash}  ${name}`;
});

fs.writeFileSync(OUT, lines.join('\n') + '\n');
for (const line of lines) console.log(line);
console.log('\nwrote', path.relative(process.cwd(), OUT));
