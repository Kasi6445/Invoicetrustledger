'use strict';
// Builds the React portal and copies the output into api/public, where
// server.js serves it as the same-origin hosted frontend.
// Cross-platform (Windows/Linux) — used both locally and by render.yaml.
// Assumes portal dependencies are installed (npm install in portal/ first).
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const portalDir = path.join(__dirname, '..', 'portal');
const distDir = path.join(portalDir, 'dist');
const publicDir = path.join(__dirname, 'public');

console.log('> vite build (portal/)');
execSync('npm run build', { cwd: portalDir, stdio: 'inherit', shell: true });

console.log(`> copy ${distDir} -> ${publicDir}`);
fs.rmSync(publicDir, { recursive: true, force: true });
fs.cpSync(distDir, publicDir, { recursive: true });

console.log('Portal built into api/public — node server.js now serves it on one port.');
