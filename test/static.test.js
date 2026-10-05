'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');

// Loads the static build's scripts into a fake browser window, the same way
// index.html does on GitHub Pages.
function loadStaticBuild(storage = new Map()) {
  const window = {
    crypto: { randomUUID: () => require('crypto').randomUUID() },
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
    },
    URL,
  };
  window.self = window;
  window.window = window;
  const context = vm.createContext(window);
  for (const file of ['lib/logic.js', 'lib/recipes.js', 'lib/nutrition.js', 'lib/routes.js', 'local-api.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, '_site', file), 'utf8'), context, { filename: file });
  }
  // Copy results out of the sandbox so assertions compare plain Node values.
  const request = (...args) => {
    const result = window.FoodLoopLocal.request(...args);
    return result === null ? null : JSON.parse(JSON.stringify(result));
  };
  return { local: { request }, storage };
}

test('static build runs the API in the browser with localStorage', () => {
  execFileSync(process.execPath, [path.join(root, 'scripts', 'build-static.js')], { stdio: 'ignore' });
  for (const file of ['index.html', 'app.js', 'styles.css', 'local-api.js', 'lib/routes.js', '.nojekyll']) {
    assert.ok(fs.existsSync(path.join(root, '_site', file)), `${file} missing from build`);
  }

  const { local, storage } = loadStaticBuild();
  assert.deepEqual(local.request('GET', '/api/pantry'), []);
  const item = local.request('POST', '/api/pantry', { name: 'Bananas', expiresOn: '2099-01-01' });
  assert.equal(item.name, 'Bananas');
  assert.throws(() => local.request('POST', '/api/pantry', { name: '' }), /Validation failed: name is required/);
  assert.throws(() => local.request('GET', '/api/nope'), /Not found/);

  // A fresh page load sees the saved data.
  const reloaded = loadStaticBuild(storage).local;
  assert.deepEqual(reloaded.request('GET', '/api/pantry?all=1').map((i) => i.name), ['Bananas']);
  reloaded.request('PATCH', `/api/pantry/${item.id}`, { outcome: 'eaten' });
  assert.equal(reloaded.request('GET', '/api/stats').rescueRate, 100);
  assert.equal(reloaded.request('DELETE', `/api/pantry/${item.id}`), null);
});
