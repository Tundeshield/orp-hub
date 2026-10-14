# Backup & recovery

ORP Hub's data lives in Cloud Firestore. Google stores it redundantly, but you still need backups to recover from mistakes (e.g. someone deleting the wrong ministry) or a compromised account.

Firebase's built-in scheduled backups require the paid Blaze plan, so ORP Hub uses two free methods.

## 1. Monthly in-app backup (administrator, 1 minute)

1. Sign in as the administrator → **Admin → Backup → Download backup**.
2. Save the `orp-hub-backup-YYYY-MM-DD.json` file to a private, shared-with-few location (e.g. a restricted Google Drive folder).

This covers finance, the ledger, appointments, reports, tasks, people and the audit history. For privacy it **excludes** pastoral follow-ups, prayer requests, meeting notes and private notes.

## 2. Full backup (technical person, quarterly)

Covers everything, including confidential pastoral records.

1. Firebase console → **Project settings → Service accounts → Generate new private key**. This file grants full access: keep it offline and never commit it to GitHub (`.gitignore` already excludes `service-account*.json`).
2. On a computer with Node.js 20+ and this repository:
   ```bash
   npm install
   node scripts/backup.mjs ./service-account.json
   ```
3. The file is written to `backups/orp-hub-full-YYYY-MM-DD.json`. Store it securely (it contains confidential pastoral notes), then delete the local copy and, ideally, the service-account key (Firebase → Service accounts → manage keys).

## Restoring

`scripts/restore.mjs` writes documents from a backup file back into Firestore. Existing documents with the same ID are overwritten; anything not in the backup is left alone.

```bash
# dry run: shows what would be restored
node scripts/restore.mjs ./service-account.json ./backups/orp-hub-full-2026-10-01.json
# restore only some collections
node scripts/restore.mjs ./service-account.json ./backup.json --only=funds,requests,transactions --yes
# restore everything
node scripts/restore.mjs ./service-account.json ./backup.json --yes
```

Notes:

- **Finance consistency:** restore `funds`, `requests` and `transactions` together from the same backup so the totals and the ledger agree.
- **User logins** live in Firebase Authentication, not Firestore, and aren't in the backup. If accounts were deleted, people sign up again with the same email and the administrator re-activates them; their profile document (roles) can be restored from the `users` collection, keyed by the new user ID.
- **Restoring into a new project:** create the project as in the README (Authentication, Firestore, rules), then run the restore with the new project's service-account key.

## If an account is compromised

1. Admin → People & roles → untick **Account active** (takes effect immediately).
2. Firebase console → Authentication → find the user → **Disable account**.
3. Check **Admin → Audit history** for what the account did. Ledger entries can't be deleted, so any unauthorised payment record stays visible; correct it with a refund entry.
