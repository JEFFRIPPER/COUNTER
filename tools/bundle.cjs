'use strict';
// Собирает src/index.html со встроенными styles.css, core.js и app.js и подставляет версию — так же, как build.ps1.
const fs = require('node:fs');
const path = require('node:path');
const src = path.join(__dirname, '../src');
const parts = ['styles.css', 'core.js', 'app.js'];

function bundle() {
  let html = fs.readFileSync(path.join(src, 'index.html'), 'utf8');
  for (const name of parts) {
    // Маркер занимает всю строку; checkout на Windows может дать CRLF.
    const marker = new RegExp('@@' + name.replace('.', '\\.') + '@@\\r?\\n');
    if (!marker.test(html)) throw new Error('Marker missing in src/index.html: ' + name);
    html = html.replace(marker, () => fs.readFileSync(path.join(src, name), 'utf8'));
  }
  // Версия в шапке — major.minor из package.json, как в build.ps1.
  const version = require('../package.json').version.split('.').slice(0, 2).join('.');
  return html.split('__COUNTER_VERSION__').join(version);
}

module.exports = { bundle, parts };
if (require.main === module) {
  const out = process.argv[2];
  if (out) fs.writeFileSync(out, bundle()); else process.stdout.write(bundle());
}
