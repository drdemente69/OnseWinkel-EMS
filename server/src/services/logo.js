// Resolve the company logo path robustly so the PDF generators don't depend
// on the exact absolute path that was stored in `settings.company.logoPath`.
//
// Settings used to be seeded with an absolute path like
// `/Users/.../data/logo.jpg`. That works on the seeder's machine but not on
// AWS (or any other host with a different filesystem layout). We try, in
// order:
//   1. The stored logoPath as-is, if it's absolute and exists.
//   2. The basename of the stored logoPath joined to config.dataDir.
//   3. The stored logoPath joined to config.dataDir (handles relative paths).
//   4. data/logo.jpg / data/logo.png as a last-resort fallback.
//
// Returns an absolute filesystem path that exists, or null if none found.

import fs from 'node:fs';
import path from 'node:path';
import config from '../config.js';

export function resolveLogoPath(stored) {
  const candidates = [];
  if (stored && typeof stored === 'string') {
    if (path.isAbsolute(stored)) candidates.push(stored);
    candidates.push(path.join(config.dataDir, path.basename(stored)));
    candidates.push(path.join(config.dataDir, stored));
  }
  candidates.push(
    path.join(config.dataDir, 'logo.jpg'),
    path.join(config.dataDir, 'logo.png'),
  );
  for (const p of candidates) {
    try { if (p && fs.existsSync(p)) return p; } catch {}
  }
  return null;
}
