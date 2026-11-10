import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist_bundle');

console.log('==> Step 1: Building marketing landing site...');
execSync('node build.mjs', { cwd: root, stdio: 'inherit' });

console.log('==> Step 2: Building React dashboard SPA...');
execSync('npx vite build --config web/vite.config.js', { cwd: root, stdio: 'inherit' });

console.log('==> Step 3: Combining marketing site & dashboard into dist_bundle...');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

// Copy marketing site (dist/) -> dist_bundle/
const copyRecursive = (src, dest) => {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
};
copyRecursive(path.join(root, 'dist'), out);

// Copy React dashboard index.html as app.html (so SPA rewrites can serve it)
const webDist = path.join(root, 'web', 'dist');
if (fs.existsSync(path.join(webDist, 'index.html'))) {
  fs.copyFileSync(path.join(webDist, 'index.html'), path.join(out, 'app.html'));
}

// Copy React dashboard assets -> dist_bundle/assets
const webAssets = path.join(webDist, 'assets');
if (fs.existsSync(webAssets)) {
  const destAssets = path.join(out, 'assets');
  fs.mkdirSync(destAssets, { recursive: true });
  for (const file of fs.readdirSync(webAssets)) {
    fs.copyFileSync(path.join(webAssets, file), path.join(destAssets, file));
  }
}

console.log('==> Done! Combined production bundle ready at dist_bundle/');
