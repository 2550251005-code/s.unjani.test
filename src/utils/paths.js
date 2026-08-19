const path = require('path');

const rootDir = path.resolve(__dirname, '..', '..');
const publicDir = path.join(rootDir, 'public');
const publicAssetsDir = path.join(publicDir, 'assets');

const resolveFromPublic = (...segments) => path.join(publicDir, ...segments);
const resolveFromAssets = (...segments) => path.join(publicAssetsDir, ...segments);

module.exports = {
  rootDir,
  publicDir,
  publicAssetsDir,
  resolveFromPublic,
  resolveFromAssets,
};
