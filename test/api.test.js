'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createApp } = require('../server');
const Store = require('../src/store');

const NOW = new Date(2026, 9, 5, 12, 0);

async function withServer(fn) {
  const store = new Store(null); // in-memory
  const server = http.createServer(createApp({ store, now: () => NOW }));
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  try {
    await fn(call, base);
  } finally {
    server.close();
  }
}

test('pantry lifecycle: add, list sorted by expiry, resolve, stats', () => withServer(async (call) => {
  const a = await call('POST', '/api/pantry', { name: 'Yoghurt', expiresOn: '2026-10-08', weightKg: 0.5, price: 2 });
  assert.equal(a.status, 201);
  assert.equal(a.body.urgency, 'soon');
  const b = await call('POST', '/api/pantry', { name: 'Bananas', expiresOn: '2026-10-05', weightKg: 1, price: 1.5 });
  assert.equal(b.body.urgency, 'critical');

  const list = await call('GET', '/api/pantry');
  assert.deepEqual(list.body.map((i) => i.name), ['Bananas', 'Yoghurt']);

  const eaten = await call('PATCH', `/api/pantry/${b.body.id}`, { outcome: 'eaten' });
  assert.equal(eaten.body.outcome, 'eaten');
  assert.equal((await call('PATCH', `/api/pantry/${b.body.id}`, { outcome: 'wasted' })).status, 409);
  assert.equal((await call('PATCH', `/api/pantry/${a.body.id}`, { outcome: 'lost' })).status, 400);

  assert.equal((await call('GET', '/api/pantry')).body.length, 1);
  assert.equal((await call('GET', '/api/pantry?all=1')).body.length, 2);

  const stats = await call('GET', '/api/stats');
  assert.equal(stats.body.savedKg, 1);
  assert.equal(stats.body.savedMoney, 1.5);
  assert.equal(stats.body.rescueRate, 100);
}));

test('recipes endpoint suggests dishes for expiring food', () => withServer(async (call) => {
  await call('POST', '/api/pantry', { name: 'Bananas', expiresOn: '2026-10-06' });
  const res = await call('GET', '/api/recipes');
  assert.equal(res.status, 200);
  assert.ok(res.body.some((r) => r.name === 'Banana bread'));
}));

test('share board: post, list, claim once', () => withServer(async (call) => {
  const bad = await call('POST', '/api/listings', { title: 'Bread' });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.details.length >= 2);

  const posted = await call('POST', '/api/listings', {
    title: '6 bagels', location: 'Oak St lobby', expiresOn: '2026-10-06', pickupWindow: 'Today 5-8pm',
  });
  assert.equal(posted.status, 201);
  await call('POST', '/api/listings', { title: 'Old soup', location: 'X', expiresOn: '2026-10-04' });

  const open = await call('GET', '/api/listings');
  assert.deepEqual(open.body.map((l) => l.title), ['6 bagels']); // expired listing hidden

  const claimed = await call('POST', `/api/listings/${posted.body.id}/claim`, { name: 'Sam' });
  assert.equal(claimed.body.status, 'claimed');
  assert.equal(claimed.body.claimedBy, 'Sam');
  assert.equal((await call('POST', `/api/listings/${posted.body.id}/claim`, {})).status, 409);
  assert.equal((await call('GET', '/api/listings')).body.length, 0);
  assert.equal((await call('GET', '/api/stats')).body.communityMealsShared, 1);
}));

test('sharing a pantry item creates a listing and marks the item shared', () => withServer(async (call) => {
  const item = await call('POST', '/api/pantry', { name: 'Lettuce', expiresOn: '2026-10-06', category: 'produce' });
  const missingLocation = await call('POST', `/api/pantry/${item.body.id}/share`, {});
  assert.equal(missingLocation.status, 400);

  const shared = await call('POST', `/api/pantry/${item.body.id}/share`, { location: 'Flat 3B' });
  assert.equal(shared.status, 201);
  assert.equal(shared.body.title, 'Lettuce');
  assert.equal(shared.body.category, 'produce');

  const all = await call('GET', '/api/pantry?all=1');
  assert.equal(all.body[0].outcome, 'shared');
  assert.equal((await call('GET', '/api/listings')).body.length, 1);
}));

test('error handling: bad JSON, unknown routes, wrong methods, path traversal', () => withServer(async (call, base) => {
  assert.equal((await call('POST', '/api/pantry', '{not json')).status, 400);
  assert.equal((await call('POST', '/api/pantry', '[1,2]')).status, 400);
  assert.equal((await call('GET', '/api/nope')).status, 404);
  assert.equal((await call('PUT', '/api/pantry')).status, 405);
  assert.equal((await call('DELETE', '/api/pantry/does-not-exist')).status, 404);

  const index = await fetch(`${base}/`);
  assert.equal(index.status, 200);
  assert.match(await index.text(), /FoodLoop/);
  const traversal = await fetch(`${base}/..%2fpackage.json`);
  assert.ok([403, 404].includes(traversal.status));
}));
