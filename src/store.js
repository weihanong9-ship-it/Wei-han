'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Minimal JSON-file persistence. Writes go to a temp file then rename,
// so a crash mid-write never leaves a half-written database.
class Store {
  constructor(file) {
    this.file = file;
    this.data = { pantry: [], listings: [] };
    if (file && fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      this.data = { pantry: parsed.pantry || [], listings: parsed.listings || [] };
    }
  }

  save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  static id() {
    return crypto.randomUUID();
  }

  list(collection) {
    return this.data[collection];
  }

  find(collection, id) {
    return this.data[collection].find((r) => r.id === id);
  }

  insert(collection, record) {
    const row = { id: Store.id(), createdAt: new Date().toISOString(), ...record };
    this.data[collection].push(row);
    this.save();
    return row;
  }

  update(collection, id, changes) {
    const row = this.find(collection, id);
    if (!row) return null;
    Object.assign(row, changes, { updatedAt: new Date().toISOString() });
    this.save();
    return row;
  }

  remove(collection, id) {
    const before = this.data[collection].length;
    this.data[collection] = this.data[collection].filter((r) => r.id !== id);
    const removed = this.data[collection].length !== before;
    if (removed) this.save();
    return removed;
  }
}

module.exports = Store;
