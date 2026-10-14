// Restores a backup JSON (from scripts/backup.mjs or the in-app Admin → Backup) into Firestore.
// Usage: node scripts/restore.mjs <service-account.json> <backup.json> [--only=funds,requests] [--yes]
// Existing documents with the same ID are overwritten; other documents are left alone.
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const [keyPath, backupPath, ...flags] = process.argv.slice(2);
if (!keyPath || !backupPath) { console.error('Usage: node scripts/restore.mjs <service-account.json> <backup.json> [--only=a,b] [--yes]'); process.exit(1); }
const only = flags.find((f) => f.startsWith('--only='))?.slice(7).split(',');
const key = JSON.parse(readFileSync(keyPath, 'utf8'));
const backup = JSON.parse(readFileSync(backupPath, 'utf8'));
const des = (v) => {
  if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 1 && v.__ts) return Timestamp.fromDate(new Date(v.__ts));
  if (Array.isArray(v)) return v.map(des);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, des(x)]));
  return v;
};
const names = Object.keys(backup.collections).filter((c) => !only || only.includes(c));
console.log(`Restoring into project "${key.project_id}" from backup taken ${backup.exportedAt}: ${names.join(', ')}`);
if (!flags.includes('--yes')) { console.log('Dry run. Re-run with --yes to write.'); process.exit(0); }
initializeApp({ credential: cert(key) });
const db = getFirestore();
for (const name of names) {
  const docs = backup.collections[name];
  for (let i = 0; i < docs.length; i += 400) {
    const batch = db.batch();
    for (const { id, ...data } of docs.slice(i, i + 400)) batch.set(db.collection(name).doc(id), des(data));
    await batch.commit();
  }
  console.log(`${name}: ${docs.length} restored`);
}
