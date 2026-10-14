# Pastor's Desk (ORP Hub)

*Pastoral work, organised.* Built for The Elevation Church · Ijebu Ode.

A simple, free-to-run web app for the **Office of the Resident Pastor**: financial approvals and payments, the pastor's appointments, ministry reports, pastoral care, and tasks, all in one place.

- **Stack:** React (Vite) · Firebase Authentication · Cloud Firestore · Netlify · GitHub
- **Cost:** ₦0. Runs entirely on Firebase's free Spark plan and Netlify's free tier. No paid services, no servers to maintain.
- **Guides:** [User guide](docs/USER_GUIDE.md) · [Backup & recovery](docs/BACKUP_AND_RECOVERY.md)

## What it does

| Section | Highlights |
|---|---|
| **Dashboard** | A personal inbox of everything waiting on you: approvals, payments due, reports to submit or review, tasks, follow-ups, new accounts. Appointment reminders for the next 24 hours. |
| **Finance** | Funds and budget allocations, financial requests, pastor approval / rejection / clarification, payments, advances, refunds, income receipts, closing requests, reconciliations, a permanent ledger, summaries and CSV / PDF reports. NGN only, stored as integer kobo so totals are exact. |
| **Meetings** | The pastor or assistant publishes availability; anyone books a slot directly. Double-booking is impossible (enforced by the database). Cancel, reschedule, add to calendar (with reminders), meeting notes, decisions and follow-up tasks. Confidential notes are pastor-only. |
| **Reports** | Standard ministry templates, report requests to ministry leaders, pending / submitted / overdue / reviewed tracking, revision requests, consolidated summaries, and turning issues into tasks. |
| **Pastor** | Overview of the week's appointments and commitments, pastoral follow-ups with reminders, prayer requests and testimonies (with confidential option), and private notes that only the pastor can read. |
| **Tasks & notifications** | Assign tasks with priority, due date and status; overdue tracking; in-app notifications for approvals, appointments, reports and tasks. |
| **Admin** | Activate accounts and assign roles, manage ministries and their leaders, view the permanent audit history, download backups. |

## Roles

| Role | Can |
|---|---|
| Administrator | Manage people, roles, ministries; see audit history; download backups. Cannot approve money or read private pastoral notes. |
| Resident Pastor | Approve/reject/clarify every financial request; see all finance; manage diary; review reports; pastoral follow-ups, prayer inbox, private notes. |
| Pastor's Assistant | Manage availability and appointments; review reports; follow-ups; non-confidential prayer requests and meeting notes. |
| Finance Officer | The only role that records payments, advances, refunds, income and reconciliations. Creates funds and budget allocations. |
| Ministry Leader | Submits ministry reports and financial requests; books appointments. |
| Staff / Member | Submits financial requests and prayer requests; books appointments. |

A person can hold more than one role. All permissions are enforced in [`firestore.rules`](firestore.rules), not just hidden in the interface.

## How the money is protected

- Every request starts as **Awaiting approval**. Only the pastor can approve it, and the database refuses an approval that would exceed the fund's available balance.
- Fund totals (budget, committed, paid) can only change together with a new **ledger entry**, and the rules check that the totals move by exactly that entry's amount.
- Ledger entries and the audit history **cannot be edited or deleted** by anyone. Mistakes are corrected with a new entry (refund, budget reduction, close).
- Once approved, a request cannot be edited by the requester. Payments can never exceed the approved amount.
- The finance maths is covered by unit tests (`src/lib/finance.test.js`) and the rules by emulator tests (`tests/rules.test.js`).

## Setup

### 1. Firebase (free Spark plan)

1. Create a project at <https://console.firebase.google.com>.
2. **Authentication → Sign-in method →** enable **Email/Password**.
3. **Authentication → Settings → Authorized domains →** add your Netlify domain (e.g. `orp-hub.netlify.app`).
4. **Firestore Database → Create database →** production mode, nearest location.
5. **Firestore → Rules →** paste the contents of [`firestore.rules`](firestore.rules) and click **Publish**. Do this again whenever `firestore.rules` changes.
6. **Project settings → Your apps → Web app →** copy the config values into the environment variables below.

### 2. Environment variables

Set these in **Netlify → Site configuration → Environment variables** (and in a local `.env` for development, see `.env.example`):

| Variable | Value |
|---|---|
| `VITE_FIREBASE_API_KEY` | from the Firebase web app config |
| `VITE_FIREBASE_AUTH_DOMAIN` | e.g. `your-project.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID` | e.g. `your-project` |
| `VITE_FIREBASE_STORAGE_BUCKET` | from config (not used, but harmless) |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | from config |
| `VITE_FIREBASE_APP_ID` | from config |
| `VITE_CHURCH_NAME` | name shown in the header |

These are public client identifiers, not secrets. Security comes from the Firestore rules.

### 3. Netlify

Connect the GitHub repository (**Add new project → Import an existing project**). The build settings come from [`netlify.toml`](netlify.toml): command `npm run build`, publish directory `dist`. Every push to `main` deploys automatically.

### 4. First sign-in

The **first account created becomes the Administrator**. Sign up with your own email first, then:

1. Admin → **Ministries**: add the ministries/departments.
2. Ask the pastor, assistant, finance officer and leaders to create accounts; activate each in **Admin → People & roles** and assign roles. Set each ministry's leader.
3. Reports → **Templates**: install the standard templates.
4. Finance: the finance officer creates funds and allocates the budget.
5. Meetings → **Availability**: the pastor or assistant publishes appointment slots.

## Development

```bash
npm install
cp .env.example .env   # fill in your Firebase config
npm run dev
```

### Testing

```bash
npm test            # unit tests: finance maths, overspending, booking conflicts, report consolidation
npm run test:rules  # security-rules tests against the Firestore emulator (needs Java 17+)
npm run test:e2e    # Playwright workflows (needs emulators running + seeded; see CI)
```

GitHub Actions ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs lint, unit tests, rules tests, and end-to-end tests on desktop and mobile viewports on every push. Screenshots from the last run are pushed to the `ci-screenshots` branch.

### Demo data (emulator only)

```bash
npm run emulators         # terminal 1
npm run seed:emulator     # terminal 2 — realistic demo data for every workflow
VITE_USE_EMULATORS=true VITE_FIREBASE_API_KEY=demo VITE_FIREBASE_PROJECT_ID=demo-orp npm run dev
```

Demo accounts (password `Password123!`): `admin@orp.test`, `pastor@orp.test`, `assistant@orp.test`, `finance@orp.test`, `youth@orp.test`, `choir@orp.test`, `ushers@orp.test`, `children@orp.test`, `member@orp.test`. The seed script refuses to run against anything but a `demo-` emulator project, so demo data never reaches production.

## Free-tier design choices

- **No Firebase Storage.** New Storage buckets now require the paid Blaze plan, so receipts and documents are recorded as a reference number or a link (e.g. a Google Drive link) on each ledger entry.
- **No Cloud Functions.** Notifications are delivered in-app (bell icon and dashboard inbox). Appointment reminders come from the dashboard and from the **Add to calendar** file, which sets 1-day and 1-hour reminders in the person's phone calendar.
- **Free-tier headroom:** Spark allows 50,000 reads and 20,000 writes per day, which is far beyond what a pastor's office needs.

## Project structure

```
src/
  lib/            finance maths, money, dates, slots, CSV/ICS, data helpers (+ unit tests)
  pages/          Dashboard, finance/, meetings/, reports/, pastor/, Tasks, Notifications, admin/
  components/     Layout and shared UI
firestore.rules   all permissions and money/booking invariants
tests/            security-rules tests
e2e/              Playwright end-to-end tests
scripts/          emulator seed, full backup, restore
docs/             user guide, backup & recovery
```
