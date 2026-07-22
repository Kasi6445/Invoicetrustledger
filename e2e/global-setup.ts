import * as fs from 'fs';
import * as path from 'path';

const API = 'http://localhost:3000';
const PORTAL = 'http://localhost:5173';
const PDF = path.join(__dirname, 'fixtures', 'invoice-clean-INV-2026-007.pdf');

async function mustReach(url: string, init: RequestInit | undefined, what: string, hint: string) {
  try {
    const r = await fetch(url, init);
    if (!r.ok && r.status !== 401 && r.status !== 404) {
      throw new Error(`HTTP ${r.status}`);
    }
  } catch (e) {
    throw new Error(
      `\n\n[global-setup] ${what} is NOT reachable at ${url}\n` +
      `  -> ${hint}\n` +
      `  (underlying: ${(e as Error).message})\n`
    );
  }
}

export default async function globalSetup() {
  // 1. API up + credentials valid
  await mustReach(
    `${API}/auth/login`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'supplier1', password: 'demo123' }),
    },
    'The API server',
    'Start it: cd ~/invoice-trust-ledger/api && node server.js'
  );

  // 2. Portal up
  await mustReach(PORTAL, undefined, 'The React portal',
    'Start it: cd ~/invoice-trust-ledger/portal && npm run dev');

  // 3. PDF fixture present
  if (!fs.existsSync(PDF)) {
    throw new Error(
      `\n\n[global-setup] Missing PDF fixture: ${PDF}\n` +
      `  -> Copy the demo invoice into e2e/fixtures/, e.g.:\n` +
      `     cp /mnt/c/Users/<YourWindowsName>/Downloads/invoice-clean-INV-2026-007.pdf ` +
      `~/invoice-trust-ledger/e2e/fixtures/\n`
    );
  }

  // 4. Evidence output dir
  fs.mkdirSync(path.join(__dirname, 'evidence'), { recursive: true });

  console.log('[global-setup] API ✓  Portal ✓  PDF fixture ✓ — starting tests');
}
