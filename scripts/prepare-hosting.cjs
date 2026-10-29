'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const target = path.join(root, 'public');
fs.mkdirSync(target, { recursive: true });
for (const name of ['index.html', 'manifest.webmanifest', 'assets']) {
  fs.cpSync(path.join(root, name), path.join(target, name), { recursive: true });
}
console.log('Prepared Hosting: index.html, manifest.webmanifest, assets/');
