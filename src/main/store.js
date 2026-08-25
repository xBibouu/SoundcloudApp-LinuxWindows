const fs = require('fs');
const path = require('path');
const { app } = require('electron');

class Store {
  constructor(name = 'config', defaults = {}) {
    this.file = path.join(app.getPath('userData'), `${name}.json`);
    this.data = { ...defaults };
    try {
      Object.assign(this.data, JSON.parse(fs.readFileSync(this.file, 'utf8')));
    } catch {
    }
  }

  get(key, fallback) {
    return this.data[key] === undefined ? fallback : this.data[key];
  }

  set(key, value) {
    this.data[key] = value;
    this.save();
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    } catch (err) {
      console.error('[store] save failed:', err.message);
    }
  }
}

module.exports = { Store };
