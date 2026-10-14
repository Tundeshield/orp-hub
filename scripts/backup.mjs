// Full backup of every Firestore collection (including confidential pastoral data) to a JSON file.
// Usage: node scripts/backup.mjs path/to/service-account.json
// Keep the output file and the service-account key somewhere private. Never commit them.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const keyPath = process.argv[2];
if (!keyPath) { console.error('Usage: node scripts/backup.mjs <service-account.json>'); process.exit(1); }
const key = JSON.parse(readFileSync(keyPath, 'utf8'));
initializeApp({ credential: cert(key) });
const db = getFirestore();

const ser = (v) => {
  if (v instanceof Timestamp) return { __ts: v.toDate().toISOString() };
  if (Array.isArray(v)) return v.map(ser);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, ser(x)]));
  return v;
};

// Walks every collection, including each branch's subcollections (branches/{id}/funds, …).
// Collections are keyed by their full path, e.g. "branches/ijebu-ode/funds".
const out = { project: key.project_id, exportedAt: new Date().toISOString(), collections: {} };
async function walk(collections) {
  for (const c of collections) {
    const snap = await c.get();
    out.collections[c.path] = snap.docs.map((d) => ({ id: d.id, ...ser(d.data()) }));
    console.log(`${c.path}: ${snap.size}`);
    for (const d of snap.docs) await walk(await d.ref.listCollections());
  }
}
await walk(await db.listCollections());
mkdirSync('backups', { recursive: true });
const file = `backups/orp-hub-full-${new Date().toISOString().slice(0, 10)}.json`;
writeFileSync(file, JSON.stringify(out));
console.log(`Saved ${file}`);
