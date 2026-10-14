// Security rules tests. Run with: npm run test:rules (needs Java + the Firestore emulator).
// These run automatically in GitHub Actions on every push.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, query, where, writeBatch, Timestamp } from 'firebase/firestore';

let env;
const USERS = {
  admin: ['admin'], pastor: ['pastor'], assistant: ['assistant'], finance: ['finance'],
  leader: ['leader'], leader2: ['leader'], member: ['member'],
};
const db = (uid) => env.authenticatedContext(uid, { email: `${uid}@test.org` }).firestore();
const ts = (d) => Timestamp.fromDate(d);
const tl = (uid) => ({ at: Timestamp.now(), by: uid, byName: uid, action: 'x', note: '' });

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-orp',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
afterAll(async () => { await env?.cleanup(); });

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const a = ctx.firestore();
    await setDoc(doc(a, 'meta/setup'), { adminUid: 'admin' });
    for (const [uid, roles] of Object.entries(USERS)) {
      await setDoc(doc(a, 'users', uid), { name: uid, email: `${uid}@test.org`, roles, active: true });
    }
    await setDoc(doc(a, 'users/pending'), { name: 'p', email: 'pending@test.org', roles: [], active: false });
    await setDoc(doc(a, 'funds/F'), { name: 'Welfare', allocated: 100000, committed: 0, paid: 0, lastTxId: null, active: true });
    await setDoc(doc(a, 'requests/R'), {
      title: 'Chairs', fundId: 'F', amount: 50000, paid: 0, released: 0, status: 'pending', requestedBy: 'leader',
      lastTxId: null, timeline: [tl('leader')],
    });
    await setDoc(doc(a, 'requests/BIG'), {
      title: 'Bus', fundId: 'F', amount: 150000, paid: 0, released: 0, status: 'pending', requestedBy: 'leader',
      lastTxId: null, timeline: [tl('leader')],
    });
    const start = new Date(Date.now() + 86400000);
    await setDoc(doc(a, 'slots/S1'), { start: ts(start), end: ts(new Date(start.getTime() + 1800000)), status: 'open', appointmentId: null, bookedBy: null });
  });
});

// ---- helpers that mirror the app's batched writes ----
function ledgerBatch(d, uid, { type, amount, requestId = null, fund, req, reqPatch = {} }) {
  const b = writeBatch(d);
  const tx = doc(collection(d, 'transactions'));
  b.set(tx, { type, fundId: 'F', requestId, amount, createdBy: uid, note: '' });
  b.update(doc(d, 'funds/F'), { ...fund, lastTxId: tx.id });
  if (requestId) b.update(doc(d, 'requests', requestId), { ...reqPatch, lastTxId: tx.id, timeline: [...req.timeline, tl(uid)] });
  return b;
}
async function getReq(id) {
  let r;
  await env.withSecurityRulesDisabled(async (ctx) => { r = (await getDoc(doc(ctx.firestore(), 'requests', id))).data(); });
  return r;
}
async function approveR() {
  const req = await getReq('R');
  await ledgerBatch(db('pastor'), 'pastor', { type: 'commit', amount: 50000, requestId: 'R', fund: { committed: 50000 }, req, reqPatch: { status: 'approved' } }).commit();
}

describe('accounts', () => {
  it('first user can bootstrap as admin only when no setup exists', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => { await deleteDoc(doc(ctx.firestore(), 'meta/setup')); });
    const d = env.authenticatedContext('newadmin', { email: 'newadmin@test.org' }).firestore();
    const b = writeBatch(d);
    b.set(doc(d, 'users/newadmin'), { name: 'x', email: 'newadmin@test.org', roles: ['admin'], active: true });
    b.set(doc(d, 'meta/setup'), { adminUid: 'newadmin' });
    await assertSucceeds(b.commit());
  });
  it('later sign-ups cannot make themselves admin', async () => {
    const d = env.authenticatedContext('eve', { email: 'eve@test.org' }).firestore();
    await assertFails(setDoc(doc(d, 'users/eve'), { name: 'e', email: 'eve@test.org', roles: ['admin'], active: true }));
    await assertSucceeds(setDoc(doc(d, 'users/eve'), { name: 'e', email: 'eve@test.org', roles: [], active: false }));
  });
  it('users cannot change their own roles', async () => {
    await assertFails(updateDoc(doc(db('member'), 'users/member'), { roles: ['pastor'] }));
    await assertSucceeds(updateDoc(doc(db('member'), 'users/member'), { name: 'New name' }));
  });
  it('admin can assign roles', async () => {
    await assertSucceeds(updateDoc(doc(db('admin'), 'users/pending'), { roles: ['leader'], active: true }));
  });
  it('pending users see nothing', async () => {
    const d = env.authenticatedContext('pending', { email: 'pending@test.org' }).firestore();
    await assertFails(getDoc(doc(d, 'funds/F')));
    await assertSucceeds(getDoc(doc(d, 'users/pending')));
  });
});

describe('finance', () => {
  it('requester sees own request, other leaders do not, finance does', async () => {
    await assertSucceeds(getDoc(doc(db('leader'), 'requests/R')));
    await assertFails(getDoc(doc(db('leader2'), 'requests/R')));
    await assertSucceeds(getDoc(doc(db('finance'), 'requests/R')));
    await assertSucceeds(getDocs(query(collection(db('leader2'), 'requests'), where('requestedBy', '==', 'leader2'))));
    await assertFails(getDocs(collection(db('leader2'), 'requests')));
  });
  it('anyone active can submit a request, but not pre-paid or pre-approved', async () => {
    const base = { title: 't', fundId: 'F', amount: 1000, paid: 0, released: 0, status: 'pending', requestedBy: 'member', lastTxId: null, timeline: [tl('member')] };
    await assertSucceeds(setDoc(doc(db('member'), 'requests/N1'), base));
    await assertFails(setDoc(doc(db('member'), 'requests/N2'), { ...base, status: 'approved' }));
    await assertFails(setDoc(doc(db('member'), 'requests/N3'), { ...base, paid: 1000 }));
    await assertFails(setDoc(doc(db('member'), 'requests/N4'), { ...base, amount: 10.5 }));
  });
  it('only the pastor can approve, through the ledger', async () => {
    const req = await getReq('R');
    await assertFails(updateDoc(doc(db('pastor'), 'requests/R'), { status: 'approved', timeline: [...req.timeline, tl('pastor')] }));
    await assertFails(ledgerBatch(db('finance'), 'finance', { type: 'commit', amount: 50000, requestId: 'R', fund: { committed: 50000 }, req, reqPatch: { status: 'approved' } }).commit());
    await assertFails(ledgerBatch(db('admin'), 'admin', { type: 'commit', amount: 50000, requestId: 'R', fund: { committed: 50000 }, req, reqPatch: { status: 'approved' } }).commit());
    await assertSucceeds(ledgerBatch(db('pastor'), 'pastor', { type: 'commit', amount: 50000, requestId: 'R', fund: { committed: 50000 }, req, reqPatch: { status: 'approved' } }).commit());
  });
  it('approval cannot overspend the fund', async () => {
    const req = await getReq('BIG');
    await assertFails(ledgerBatch(db('pastor'), 'pastor', { type: 'commit', amount: 150000, requestId: 'BIG', fund: { committed: 150000 }, req, reqPatch: { status: 'approved' } }).commit());
  });
  it('fund totals must match the ledger entry', async () => {
    const req = await getReq('R');
    await assertFails(ledgerBatch(db('pastor'), 'pastor', { type: 'commit', amount: 50000, requestId: 'R', fund: { committed: 10 }, req, reqPatch: { status: 'approved' } }).commit());
    await assertFails(updateDoc(doc(db('finance'), 'funds/F'), { paid: 0, allocated: 999999 }));
  });
  it('rejection and clarification are pastor-only', async () => {
    const req = await getReq('R');
    await assertFails(updateDoc(doc(db('finance'), 'requests/R'), { status: 'rejected', decisionNote: 'no', timeline: [...req.timeline, tl('finance')] }));
    await assertSucceeds(updateDoc(doc(db('pastor'), 'requests/R'), { status: 'clarification', decisionNote: 'why?', timeline: [...req.timeline, tl('pastor')] }));
    const r2 = await getReq('R');
    await assertSucceeds(updateDoc(doc(db('leader'), 'requests/R'), { status: 'pending', amount: 40000, timeline: [...r2.timeline, tl('leader')] }));
  });
  it('only the finance officer records payments, and never more than approved', async () => {
    await approveR();
    let req = await getReq('R');
    await assertFails(ledgerBatch(db('pastor'), 'pastor', { type: 'payment', amount: 20000, requestId: 'R', fund: { paid: 20000 }, req, reqPatch: { paid: 20000, status: 'partly_paid' } }).commit());
    await assertFails(ledgerBatch(db('finance'), 'finance', { type: 'payment', amount: 60000, requestId: 'R', fund: { paid: 60000 }, req, reqPatch: { paid: 60000, status: 'paid' } }).commit());
    await assertFails(ledgerBatch(db('finance'), 'finance', { type: 'payment', amount: 20000, requestId: 'R', fund: { paid: 20000 }, req, reqPatch: { paid: 20000, status: 'paid' } }).commit());
    await assertSucceeds(ledgerBatch(db('finance'), 'finance', { type: 'payment', amount: 20000, requestId: 'R', fund: { paid: 20000 }, req, reqPatch: { paid: 20000, status: 'partly_paid' } }).commit());
    req = await getReq('R');
    await assertSucceeds(ledgerBatch(db('finance'), 'finance', { type: 'payment', amount: 30000, requestId: 'R', fund: { paid: 50000 }, req, reqPatch: { paid: 50000, status: 'paid' } }).commit());
  });
  it('approved requests cannot be edited by the requester', async () => {
    await approveR();
    const req = await getReq('R');
    await assertFails(updateDoc(doc(db('leader'), 'requests/R'), { amount: 90000, status: 'pending', timeline: [...req.timeline, tl('leader')] }));
    await assertFails(updateDoc(doc(db('leader'), 'requests/R'), { status: 'cancelled', timeline: [...req.timeline, tl('leader')] }));
  });
  it('refund and release keep totals consistent', async () => {
    await approveR();
    let req = await getReq('R');
    await assertSucceeds(ledgerBatch(db('finance'), 'finance', { type: 'advance', amount: 50000, requestId: 'R', fund: { paid: 50000 }, req, reqPatch: { paid: 50000, status: 'paid' } }).commit());
    req = await getReq('R');
    await assertFails(ledgerBatch(db('finance'), 'finance', { type: 'refund', amount: 60000, requestId: 'R', fund: { paid: -10000 }, req, reqPatch: { paid: -10000, status: 'partly_paid' } }).commit());
    await assertSucceeds(ledgerBatch(db('finance'), 'finance', { type: 'refund', amount: 10000, requestId: 'R', fund: { paid: 40000 }, req, reqPatch: { paid: 40000, status: 'partly_paid' } }).commit());
    req = await getReq('R');
    await assertSucceeds(ledgerBatch(db('finance'), 'finance', { type: 'release', amount: 10000, requestId: 'R', fund: { committed: 40000 }, req, reqPatch: { released: 10000, status: 'closed' } }).commit());
  });
  it('ledger entries are permanent and private', async () => {
    await approveR();
    let txId;
    await env.withSecurityRulesDisabled(async (ctx) => { txId = (await getDocs(collection(ctx.firestore(), 'transactions'))).docs[0].id; });
    await assertFails(updateDoc(doc(db('finance'), 'transactions', txId), { amount: 1 }));
    await assertFails(deleteDoc(doc(db('admin'), 'transactions', txId)));
    await assertFails(getDoc(doc(db('leader'), 'transactions', txId)));
    await assertSucceeds(getDoc(doc(db('pastor'), 'transactions', txId)));
  });
  it('budget allocation by finance; not below commitments', async () => {
    await assertSucceeds(ledgerBatch(db('finance'), 'finance', { type: 'allocation', amount: 50000, fund: { allocated: 150000 } }).commit());
    await assertFails(ledgerBatch(db('leader'), 'leader', { type: 'allocation', amount: 50000, fund: { allocated: 200000 } }).commit());
    await approveR();
    await assertFails(ledgerBatch(db('finance'), 'finance', { type: 'allocation', amount: -120000, fund: { allocated: 30000 } }).commit());
  });
});

describe('appointments', () => {
  function book(d, uid, slotId, apptId) {
    let s;
    return env.withSecurityRulesDisabled(async (ctx) => { s = (await getDoc(doc(ctx.firestore(), 'slots', slotId))).data(); }).then(() => {
      const b = writeBatch(d);
      b.set(doc(d, 'appointments', apptId), { slotId, start: s.start, end: s.end, bookedBy: uid, attendeeUid: uid, attendeeName: uid, purpose: 'x', status: 'booked' });
      b.update(doc(d, 'slots', slotId), { status: 'booked', appointmentId: apptId, bookedBy: uid });
      return b.commit();
    });
  }
  it('a slot can only be booked once', async () => {
    await assertSucceeds(book(db('member'), 'member', 'S1', 'A1'));
    await assertFails(book(db('leader'), 'leader', 'S1', 'A2'));
  });
  it('booking details are private to the attendee and the diary team', async () => {
    await book(db('member'), 'member', 'S1', 'A1');
    await assertSucceeds(getDoc(doc(db('member'), 'appointments/A1')));
    await assertSucceeds(getDoc(doc(db('assistant'), 'appointments/A1')));
    await assertFails(getDoc(doc(db('leader'), 'appointments/A1')));
  });
  it('only the attendee or diary team can cancel', async () => {
    await book(db('member'), 'member', 'S1', 'A1');
    const cancel = (d) => {
      const b = writeBatch(d);
      b.update(doc(d, 'appointments/A1'), { status: 'cancelled', cancelReason: '' });
      b.update(doc(d, 'slots/S1'), { status: 'open', appointmentId: null, bookedBy: null });
      return b.commit();
    };
    await assertFails(cancel(db('leader')));
    await assertSucceeds(cancel(db('member')));
  });
  it('only the diary team publishes slots', async () => {
    const s = { start: ts(new Date(Date.now() + 2e8)), end: ts(new Date(Date.now() + 2e8 + 1800000)), status: 'open', appointmentId: null, bookedBy: null };
    await assertFails(setDoc(doc(db('member'), 'slots/S9'), s));
    await assertSucceeds(setDoc(doc(db('assistant'), 'slots/S9'), s));
  });
});

describe('confidential pastoral data', () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const a = ctx.firestore();
      await setDoc(doc(a, 'pastoralNotes/N'), { title: 'x', content: 'secret', createdBy: 'pastor' });
      await setDoc(doc(a, 'meetingNotes/C'), { title: 'x', confidential: true, createdBy: 'pastor' });
      await setDoc(doc(a, 'meetingNotes/O'), { title: 'y', confidential: false, createdBy: 'pastor' });
      await setDoc(doc(a, 'prayers/P'), { kind: 'prayer', content: 'x', confidential: true, status: 'new', submittedBy: 'member' });
    });
  });
  it('private notes: pastor only, not even admin', async () => {
    await assertSucceeds(getDoc(doc(db('pastor'), 'pastoralNotes/N')));
    await assertFails(getDoc(doc(db('admin'), 'pastoralNotes/N')));
    await assertFails(getDoc(doc(db('assistant'), 'pastoralNotes/N')));
  });
  it('confidential meeting notes hidden from the assistant', async () => {
    await assertFails(getDoc(doc(db('assistant'), 'meetingNotes/C')));
    await assertSucceeds(getDoc(doc(db('assistant'), 'meetingNotes/O')));
    await assertFails(getDoc(doc(db('admin'), 'meetingNotes/O')));
  });
  it('confidential prayer requests: pastor and submitter only', async () => {
    await assertSucceeds(getDoc(doc(db('pastor'), 'prayers/P')));
    await assertSucceeds(getDoc(doc(db('member'), 'prayers/P')));
    await assertFails(getDoc(doc(db('assistant'), 'prayers/P')));
    await assertFails(getDoc(doc(db('leader'), 'prayers/P')));
  });
});

describe('reports, tasks, audit', () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'reports/RP'), { leaderUid: 'leader', status: 'pending', answers: {}, timeline: [], fields: [] });
    });
  });
  it('leader submits own report; other leaders cannot read it', async () => {
    await assertFails(getDoc(doc(db('leader2'), 'reports/RP')));
    await assertSucceeds(updateDoc(doc(db('leader'), 'reports/RP'), { answers: { a: 1 }, status: 'submitted' }));
    await assertFails(updateDoc(doc(db('leader'), 'reports/RP'), { status: 'reviewed' }));
    await assertSucceeds(updateDoc(doc(db('assistant'), 'reports/RP'), { status: 'revision', reviewerNote: 'more detail' }));
  });
  it('assignees can only change task status', async () => {
    await setDoc(doc(db('pastor'), 'tasks/T'), { title: 't', assigneeUid: 'leader', createdBy: 'pastor', status: 'todo' });
    await assertSucceeds(updateDoc(doc(db('leader'), 'tasks/T'), { status: 'done' }));
    await assertFails(updateDoc(doc(db('leader'), 'tasks/T'), { assigneeUid: 'member' }));
    await assertFails(getDoc(doc(db('member'), 'tasks/T')));
  });
  it('audit history is append-only', async () => {
    await assertSucceeds(setDoc(doc(db('member'), 'audit/X'), { action: 'a', actorUid: 'member' }));
    await assertFails(setDoc(doc(db('member'), 'audit/Y'), { action: 'a', actorUid: 'pastor' }));
    await assertFails(updateDoc(doc(db('member'), 'audit/X'), { action: 'b' }));
    await assertFails(getDoc(doc(db('member'), 'audit/X')));
    await assertFails(deleteDoc(doc(db('admin'), 'audit/X')));
  });
});
