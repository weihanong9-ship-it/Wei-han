'use strict';

// Builds a server-less copy of FoodLoop into _site/ for GitHub Pages.
// The browser then runs the API itself via public/local-api.js.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, '_site');

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(root, 'public'), out, { recursive: true });
fs.mkdirSync(path.join(out, 'lib'));
for (const name of ['logic.js', 'recipes.js', 'routes.js']) {
  fs.copyFileSync(path.join(root, 'src', name), path.join(out, 'lib', name));
}
// Serve files as-is (no Jekyll processing).
fs.writeFileSync(path.join(out, '.nojekyll'), '');
console.log(`Static site written to ${path.relative(root, out)}/`);
