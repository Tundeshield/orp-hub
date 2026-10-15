// Publishes firestore.rules using the Firebase Admin SDK (Security Rules API).
// Usage: GOOGLE_APPLICATION_CREDENTIALS=service-account.json node scripts/deploy-rules.mjs
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getSecurityRules } from 'firebase-admin/security-rules';

const key = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
initializeApp({ credential: cert(key), projectId: key.project_id });
const source = readFileSync('firestore.rules', 'utf8');
const ruleset = await getSecurityRules().releaseFirestoreRulesetFromSource(source);
console.log(`Published ruleset ${ruleset.name} to ${key.project_id}`);
