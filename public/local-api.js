'use strict';

// Runs the FoodLoop API inside the browser when there is no server, such as
// on GitHub Pages. Data is kept in this browser's localStorage.
(function () {
  const STORAGE_KEY = 'foodloop-data-v1';

  function newId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  // Same interface as src/store.js.
  class BrowserStore {
    constructor() {
      this.data = { pantry: [], listings: [] };
      try {
        const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
        if (parsed) this.data = { pantry: parsed.pantry || [], listings: parsed.listings || [] };
      } catch { /* storage unavailable or corrupt: start empty */ }
    }

    save() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
      } catch { /* storage unavailable: data lasts for this visit only */ }
    }

    list(collection) {
      return this.data[collection];
    }

    find(collection, id) {
      return this.data[collection].find((r) => r.id === id);
    }

    insert(collection, record) {
      const row = { id: newId(), createdAt: new Date().toISOString(), ...record };
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

  const { HttpError, createRoutes } = window.FoodLoopRoutes;
  const api = createRoutes({ store: new BrowserStore() });

  // Mirrors the HTTP API: resolves with the payload or throws an Error whose
  // message matches what the server would send.
  window.FoodLoopLocal = {
    request(method, pathWithQuery, body) {
      const url = new URL(pathWithQuery, 'http://local');
      try {
        // Round-trip the body through JSON so stored records never share references with the UI.
        const { payload } = api.match(method, url.pathname, url.searchParams)(body ? JSON.parse(JSON.stringify(body)) : {});
        return payload === null || payload === undefined ? null : JSON.parse(JSON.stringify(payload));
      } catch (err) {
        if (err instanceof HttpError) {
          const details = err.details ? `: ${err.details.join('; ')}` : '';
          throw new Error(`${err.message}${details}`);
        }
        throw err;
      }
    },
  };
}());
