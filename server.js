'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const Store = require('./src/store');
const recipes = require('./src/recipes');
const logic = require('./src/logic');

const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY_BYTES = 16 * 1024;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, 'Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('not an object');
        }
        resolve(parsed);
      } catch {
        reject(new HttpError(400, 'Body must be a JSON object'));
      }
    });
    req.on('error', reject);
  });
}

function validated(result) {
  if (result.errors) throw new HttpError(400, 'Validation failed', result.errors);
  return result.value;
}

function createApp({ store, now = () => new Date() }) {
  // Each route: [method, pattern, handler(params, body, url)].
  const routes = [
    ['GET', /^\/api\/pantry$/, (p, b, url) => {
      const showAll = url.searchParams.get('all') === '1';
      const items = store.list('pantry').filter((i) => showAll || !i.outcome);
      return logic.sortByExpiry(items).map((i) => logic.decoratePantryItem(i, now()));
    }],
    ['POST', /^\/api\/pantry$/, (p, body) => {
      const value = validated(logic.validatePantryItem(body));
      return [201, logic.decoratePantryItem(store.insert('pantry', { ...value, outcome: null }), now())];
    }],
    ['PATCH', /^\/api\/pantry\/([\w-]+)$/, ([id], body) => {
      const item = store.find('pantry', id);
      if (!item) throw new HttpError(404, 'Item not found');
      if (!logic.OUTCOMES.includes(body.outcome)) {
        throw new HttpError(400, `outcome must be one of: ${logic.OUTCOMES.join(', ')}`);
      }
      if (item.outcome) throw new HttpError(409, 'Item already resolved');
      const updated = store.update('pantry', id, { outcome: body.outcome, resolvedAt: now().toISOString() });
      return logic.decoratePantryItem(updated, now());
    }],
    ['DELETE', /^\/api\/pantry\/([\w-]+)$/, ([id]) => {
      if (!store.remove('pantry', id)) throw new HttpError(404, 'Item not found');
      return [204, null];
    }],
    // Turn a pantry item you won't use into a public listing in one step.
    ['POST', /^\/api\/pantry\/([\w-]+)\/share$/, ([id], body) => {
      const item = store.find('pantry', id);
      if (!item) throw new HttpError(404, 'Item not found');
      if (item.outcome) throw new HttpError(409, 'Item already resolved');
      const listing = validated(logic.validateListing({
        title: item.name,
        expiresOn: item.expiresOn,
        category: item.category,
        weightKg: item.weightKg,
        ...body,
      }));
      const created = store.insert('listings', { ...listing, status: 'available', claimedBy: null, sourceItemId: id });
      store.update('pantry', id, { outcome: 'shared', resolvedAt: now().toISOString() });
      return [201, created];
    }],
    ['GET', /^\/api\/listings$/, () => store.list('listings')
      .filter((l) => logic.isListingVisible(l, now()))
      .sort((a, b) => a.expiresOn.localeCompare(b.expiresOn))
      .map((l) => ({ ...l, daysLeft: logic.daysUntil(l.expiresOn, now()) }))],
    ['POST', /^\/api\/listings$/, (p, body) => {
      const value = validated(logic.validateListing(body));
      return [201, store.insert('listings', { ...value, status: 'available', claimedBy: null })];
    }],
    ['POST', /^\/api\/listings\/([\w-]+)\/claim$/, ([id], body) => {
      const listing = store.find('listings', id);
      if (!listing) throw new HttpError(404, 'Listing not found');
      if (!logic.isListingVisible(listing, now())) throw new HttpError(409, 'Listing is no longer available');
      const claimedBy = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 60) : 'Someone';
      return store.update('listings', id, { status: 'claimed', claimedBy, claimedAt: now().toISOString() });
    }],
    ['GET', /^\/api\/recipes$/, () => logic.suggestRecipes(store.list('pantry'), recipes, now())],
    ['GET', /^\/api\/stats$/, () => {
      const stats = logic.computeStats(store.list('pantry'));
      stats.communityMealsShared = store.list('listings').filter((l) => l.status === 'claimed').length;
      return stats;
    }],
    ['GET', /^\/api\/meta$/, () => ({ categories: logic.CATEGORIES, outcomes: logic.OUTCOMES })],
  ];

  async function handleApi(req, res, url) {
    const candidates = routes.filter(([, pattern]) => pattern.test(url.pathname));
    if (!candidates.length) throw new HttpError(404, 'Not found');
    const route = candidates.find(([method]) => method === req.method);
    if (!route) throw new HttpError(405, 'Method not allowed');
    const params = url.pathname.match(route[1]).slice(1);
    const body = ['POST', 'PATCH'].includes(req.method) ? await readBody(req) : {};
    const result = await route[2](params, body, url);
    const [status, payload] = Array.isArray(result) && typeof result[0] === 'number' ? result : [200, result];
    if (status === 204) {
      res.writeHead(204);
      res.end();
    } else {
      sendJson(res, status, payload);
    }
  }

  function serveStatic(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      res.end();
      return;
    }
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.resolve(PUBLIC_DIR, rel);
    if (!file.startsWith(PUBLIC_DIR + path.sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    fs.readFile(file, (err, content) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(req.method === 'HEAD' ? undefined : content);
    });
  }

  return async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) {
        await handleApi(req, res, url);
      } else {
        serveStatic(req, res, url);
      }
    } catch (err) {
      if (err instanceof HttpError) {
        sendJson(res, err.status, { error: err.message, details: err.details });
      } else {
        console.error(err);
        sendJson(res, 500, { error: 'Internal server error' });
      }
    }
  };
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const dataFile = process.env.DATA_FILE || path.join(__dirname, 'data', 'db.json');
  const store = new Store(dataFile);
  http.createServer(createApp({ store })).listen(port, () => {
    console.log(`FoodLoop running at http://localhost:${port}`);
  });
}

module.exports = { createApp };
