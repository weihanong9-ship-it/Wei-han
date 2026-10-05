'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const Store = require('./src/store');
const { HttpError, createRoutes } = require('./src/routes');

const PUBLIC_DIR = path.join(__dirname, 'public');
// Modules shared with the browser, served under /lib/ (mirrors the Pages build).
const SHARED_FILES = {
  'lib/logic.js': path.join(__dirname, 'src', 'logic.js'),
  'lib/recipes.js': path.join(__dirname, 'src', 'recipes.js'),
  'lib/routes.js': path.join(__dirname, 'src', 'routes.js'),
  'lib/nutrition.js': path.join(__dirname, 'src', 'nutrition.js'),
};
const MAX_BODY_BYTES = 16 * 1024;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

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

function createApp({ store, now = () => new Date() }) {
  const api = createRoutes({ store, now });

  async function handleApi(req, res, url) {
    const run = api.match(req.method, url.pathname, url.searchParams);
    const body = ['POST', 'PATCH'].includes(req.method) ? await readBody(req) : {};
    const { status, payload } = run(body);
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
    let file = SHARED_FILES[rel];
    if (!file) {
      file = path.resolve(PUBLIC_DIR, rel);
      if (!file.startsWith(PUBLIC_DIR + path.sep)) {
        res.writeHead(403);
        res.end();
        return;
      }
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
