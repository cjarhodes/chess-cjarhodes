// The app's own code in the order index.html loads it: the src/ files,
// ending with the view scripts in src/views/ (app.js until Phase 6). Node
// validators that run app logic read this instead of naming files, so code
// can move between files without breaking them.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');

function appScriptFiles() {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  return [...html.matchAll(/<script src="(src\/[^"]+\.js)"><\/script>/g)].map(m => m[1]);
}

function appSource() {
  return appScriptFiles().map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
}

module.exports = { appScriptFiles, appSource, root };
