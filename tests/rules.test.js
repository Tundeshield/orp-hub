// Security rules tests. Run with: npm run test:rules (needs Java + the Firestore emulator).
// These run automatically in GitHub Actions on every push.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, query, where, writeBatch, Timestamp, serverTimestamp } from 'firebase/firestore';

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
    await setDoc(doc(a, 'meta/setup'), { adminUid: 'owner' });
    await setDoc(doc(a, 'users/owner'), { name: 'owner', email: 'owner@test.org', superAdmin: true, branchIds: [] });
    await setDoc(doc(a, 'branches/B1'), { name: 'Ijebu Ode' });
    await setDoc(doc(a, 'branches/B2'), { name: 'Abeokuta' });
    for (const [uid, roles] of Object.entries(USERS)) {
      await setDoc(doc(a, 'users', uid), { name: uid, email: `${uid}@test.org`, branchIds: ['B1'] });
      await setDoc(doc(a, 'branches/B1/members', uid), { name: uid, email: `${uid}@test.org`, roles, active: true });
    }
    await setDoc(doc(a, 'users/pending'), { name: 'p', email: 'pending@test.org', branchIds: ['B1'] });
    await setDoc(doc(a, 'branches/B1/members/pending'), { name: 'p', email: 'pending@test.org', roles: [], active: false });
    // a pastor and fund in another branch
    await setDoc(doc(a, 'users/b2pastor'), { name: 'b2', email: 'b2pastor@test.org', branchIds: ['B2'] });
    await setDoc(doc(a, 'branches/B2/members/b2pastor'), { name: 'b2', email: 'b2pastor@test.org', roles: ['pastor', 'admin'], active: true });
    await setDoc(doc(a, 'branches/B2/funds/G'), { name: 'Abeokuta fund', allocated: 5000, committed: 0, paid: 0, lastTxId: null, active: true });
    await setDoc(doc(a, 'branches/B1/funds/F'), { name: 'Welfare', allocated: 100000, committed: 0, paid: 0, lastTxId: null, active: true });
    await setDoc(doc(a, 'branches/B1/requests/R'), {
      title: 'Chairs', fundId: 'F', amount: 50000, paid: 0, released: 0, status: 'pending', requestedBy: 'leader',
      lastTxId: null, timeline: [tl('leader')],
    });
    await setDoc(doc(a, 'branches/B1/requests/BIG'), {
      title: 'Bus', fundId: 'F', amount: 150000, paid: 0, released: 0, status: 'pending', requestedBy: 'leader',
      lastTxId: null, timeline: [tl('leader')],
    });
    const start = new Date(Date.now() + 86400000);
    await setDoc(doc(a, 'branches/B1/slots/S1'), { start: ts(start), end: ts(new Date(start.getTime() + 1800000)), status: 'open', appointmentId: null, bookedBy: null });
  });
});

// ---- helpers that mirror the app's batched writes ----
function ledgerBatch(d, uid, { type, amount, requestId = null, fund, req, reqPatch = {} }) {
  const b = writeBatch(d);
  const tx = doc(collection(d, 'branches/B1/transactions'));
  b.set(tx, { type, fundId: 'F', requestId, amount, createdBy: uid, note: '' });
  b.update(doc(d, 'branches/B1/funds/F'), { ...fund, lastTxId: tx.id });
  if (requestId) b.update(doc(d, 'branches/B1/requests', requestId), { ...reqPatch, lastTxId: tx.id, timeline: [...req.timeline, tl(uid)] });
  return b;
}
async function getReq(id) {
  let r;
  await env.withSecurityRulesDisabled(async (ctx) => { r = (await getDoc(doc(ctx.firestore(), 'branches/B1/requests', id))).data(); });
  return r;
}
async function approveR() {
  const req = await getReq('R');
  await ledgerBatch(db('pastor'), 'pastor', { type: 'commit', amount: 50000, requestId: 'R', fund: { committed: 50000 }, req, reqPatch: { status: 'approved' } }).commit();
}

describe('accounts', () => {
  it('first user can bootstrap as super admin only when no setup exists', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => { await deleteDoc(doc(ctx.firestore(), 'meta/setup')); });
    const d = env.authenticatedContext('newadmin', { email: 'newadmin@test.org' }).firestore();
    const b = writeBatch(d);
    b.set(doc(d, 'users/newadmin'), { name: 'x', email: 'newadmin@test.org', superAdmin: true, branchIds: [] });
    b.set(doc(d, 'meta/setup'), { adminUid: 'newadmin' });
    await assertSucceeds(b.commit());
  });
  it('later sign-ups cannot make themselves super admin', async () => {
    const d = env.authenticatedContext('eve', { email: 'eve@test.org' }).firestore();
    await assertFails(setDoc(doc(d, 'users/eve'), { name: 'e', email: 'eve@test.org', superAdmin: true }));
    await assertSucceeds(setDoc(doc(d, 'users/eve'), { name: 'e', email: 'eve@test.org', branchIds: [] }));
    await assertFails(updateDoc(doc(d, 'users/eve'), { superAdmin: true }));
  });
  it('a newcomer can ask to join a branch but cannot give themselves a role', async () => {
    const d = env.authenticatedContext('eve', { email: 'eve@test.org' }).firestore();
    await assertFails(setDoc(doc(d, 'branches/B1/members/eve'), { name: 'e', email: 'eve@test.org', roles: ['pastor'], active: true }));
    await assertSucceeds(setDoc(doc(d, 'branches/B1/members/eve'), { name: 'e', email: 'eve@test.org', roles: [], active: false }));
  });
  it('members cannot change their own roles', async () => {
    await assertFails(updateDoc(doc(db('member'), 'branches/B1/members/member'), { roles: ['pastor'] }));
    await assertSucceeds(updateDoc(doc(db('member'), 'branches/B1/members/member'), { name: 'New name' }));
  });
  it('branch admin can assign roles in their branch only', async () => {
    await assertSucceeds(updateDoc(doc(db('admin'), 'branches/B1/members/pending'), { roles: ['leader'], active: true }));
    await assertFails(updateDoc(doc(db('admin'), 'branches/B2/members/b2pastor'), { roles: [] }));
  });
  it('pending members see nothing', async () => {
    const d = env.authenticatedContext('pending', { email: 'pending@test.org' }).firestore();
    await assertFails(getDoc(doc(d, 'branches/B1/funds/F')));
    await assertSucceeds(getDoc(doc(d, 'branches/B1/members/pending')));
  });
  it('the original setup admin can upgrade to super admin; nobody else can', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), 'meta/setup'), { adminUid: 'admin' }); });
    await assertFails(updateDoc(doc(db('member'), 'users/member'), { superAdmin: true }));
    await assertSucceeds(updateDoc(doc(db('admin'), 'users/admin'), { superAdmin: true }));
  });
});

describe('branches are isolated', () => {
  const owner = () => env.authenticatedContext('owner', { email: 'owner@test.org' }).firestore();
  it('staff of one branch cannot see another branch', async () => {
    await assertFails(getDoc(doc(db('pastor'), 'branches/B2/funds/G')));
    await assertFails(getDocs(collection(db('admin'), 'branches/B2/members')));
    await assertFails(getDoc(doc(db('b2pastor'), 'branches/B1/funds/F')));
    await assertFails(getDoc(doc(db('b2pastor'), 'branches/B1/requests/R')));
    await assertSucceeds(getDoc(doc(db('b2pastor'), 'branches/B2/funds/G')));
  });
  it('another branch\'s pastor cannot approve here', async () => {
    const req = await getReq('R');
    await assertFails(ledgerBatch(db('b2pastor'), 'b2pastor', { type: 'commit', amount: 50000, requestId: 'R', fund: { committed: 50000 }, req, reqPatch: { status: 'approved' } }).commit());
  });
  it('super admin manages every branch but cannot approve money or read private notes', async () => {
    await assertSucceeds(getDocs(collection(owner(), 'branches/B2/members')));
    await assertSucceeds(updateDoc(doc(owner(), 'branches/B2/members/b2pastor'), { roles: ['pastor'] }));
    const req = await getReq('R');
    await assertFails(ledgerBatch(owner(), 'owner', { type: 'commit', amount: 50000, requestId: 'R', fund: { committed: 50000 }, req, reqPatch: { status: 'approved' } }).commit());
    await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), 'branches/B1/pastoralNotes/N'), { createdBy: 'pastor', content: 'x' }); });
    await assertFails(getDoc(doc(owner(), 'branches/B1/pastoralNotes/N')));
  });
  it('only super admins create branches', async () => {
    await assertFails(setDoc(doc(db('admin'), 'branches/B3'), { name: 'Lagos' }));
    await assertSucceeds(setDoc(doc(owner(), 'branches/lagos'), { name: 'Lagos' }));
    await assertFails(setDoc(doc(owner(), 'branches/Bad Name!'), { name: 'x' }));
  });
});

describe('finance', () => {
  it('requester sees own request, other leaders do not, finance does', async () => {
    await assertSucceeds(getDoc(doc(db('leader'), 'branches/B1/requests/R')));
    await assertFails(getDoc(doc(db('leader2'), 'branches/B1/requests/R')));
    await assertSucceeds(getDoc(doc(db('finance'), 'branches/B1/requests/R')));
    await assertSucceeds(getDocs(query(collection(db('leader2'), 'branches/B1/requests'), where('requestedBy', '==', 'leader2'))));
    await assertFails(getDocs(collection(db('leader2'), 'branches/B1/requests')));
  });
  it('anyone active can submit a request, but not pre-paid or pre-approved', async () => {
    const base = { title: 't', fundId: 'F', amount: 1000, paid: 0, released: 0, status: 'pending', requestedBy: 'member', lastTxId: null, timeline: [tl('member')] };
    await assertSucceeds(setDoc(doc(db('member'), 'branches/B1/requests/N1'), base));
    await assertFails(setDoc(doc(db('member'), 'branches/B1/requests/N2'), { ...base, status: 'approved' }));
    await assertFails(setDoc(doc(db('member'), 'branches/B1/requests/N3'), { ...base, paid: 1000 }));
    await assertFails(setDoc(doc(db('member'), 'branches/B1/requests/N4'), { ...base, amount: 10.5 }));
  });
  it('only the pastor can approve, through the ledger', async () => {
    const req = await getReq('R');
    await assertFails(updateDoc(doc(db('pastor'), 'branches/B1/requests/R'), { status: 'approved', timeline: [...req.timeline, tl('pastor')] }));
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
    await assertFails(updateDoc(doc(db('finance'), 'branches/B1/funds/F'), { paid: 0, allocated: 999999 }));
  });
  it('rejection and clarification are pastor-only', async () => {
    const req = await getReq('R');
    await assertFails(updateDoc(doc(db('finance'), 'branches/B1/requests/R'), { status: 'rejected', decisionNote: 'no', timeline: [...req.timeline, tl('finance')] }));
    await assertSucceeds(updateDoc(doc(db('pastor'), 'branches/B1/requests/R'), { status: 'clarification', decisionNote: 'why?', timeline: [...req.timeline, tl('pastor')] }));
    const r2 = await getReq('R');
    await assertSucceeds(updateDoc(doc(db('leader'), 'branches/B1/requests/R'), { status: 'pending', amount: 40000, timeline: [...r2.timeline, tl('leader')] }));
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
    await assertFails(updateDoc(doc(db('leader'), 'branches/B1/requests/R'), { amount: 90000, status: 'pending', timeline: [...req.timeline, tl('leader')] }));
    await assertFails(updateDoc(doc(db('leader'), 'branches/B1/requests/R'), { status: 'cancelled', timeline: [...req.timeline, tl('leader')] }));
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
    await env.withSecurityRulesDisabled(async (ctx) => { txId = (await getDocs(collection(ctx.firestore(), 'branches/B1/transactions'))).docs[0].id; });
    await assertFails(updateDoc(doc(db('finance'), 'branches/B1/transactions', txId), { amount: 1 }));
    await assertFails(deleteDoc(doc(db('admin'), 'branches/B1/transactions', txId)));
    await assertFails(getDoc(doc(db('leader'), 'branches/B1/transactions', txId)));
    await assertSucceeds(getDoc(doc(db('pastor'), 'branches/B1/transactions', txId)));
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
    return env.withSecurityRulesDisabled(async (ctx) => { s = (await getDoc(doc(ctx.firestore(), 'branches/B1/slots', slotId))).data(); }).then(() => {
      const b = writeBatch(d);
      b.set(doc(d, 'branches/B1/appointments', apptId), { slotId, start: s.start, end: s.end, bookedBy: uid, attendeeUid: uid, attendeeName: uid, purpose: 'x', status: 'booked' });
      b.update(doc(d, 'branches/B1/slots', slotId), { status: 'booked', appointmentId: apptId, bookedBy: uid });
      return b.commit();
    });
  }
  it('a slot can only be booked once', async () => {
    await assertSucceeds(book(db('member'), 'member', 'S1', 'A1'));
    await assertFails(book(db('leader'), 'leader', 'S1', 'A2'));
  });
  it('booking details are private to the attendee and the diary team', async () => {
    await book(db('member'), 'member', 'S1', 'A1');
    await assertSucceeds(getDoc(doc(db('member'), 'branches/B1/appointments/A1')));
    await assertSucceeds(getDoc(doc(db('assistant'), 'branches/B1/appointments/A1')));
    await assertFails(getDoc(doc(db('leader'), 'branches/B1/appointments/A1')));
  });
  it('only the attendee or diary team can cancel', async () => {
    await book(db('member'), 'member', 'S1', 'A1');
    const cancel = (d) => {
      const b = writeBatch(d);
      b.update(doc(d, 'branches/B1/appointments/A1'), { status: 'cancelled', cancelReason: '' });
      b.update(doc(d, 'branches/B1/slots/S1'), { status: 'open', appointmentId: null, bookedBy: null });
      return b.commit();
    };
    await assertFails(cancel(db('leader')));
    await assertSucceeds(cancel(db('member')));
  });
  it('only the diary team publishes slots', async () => {
    const s = { start: ts(new Date(Date.now() + 2e8)), end: ts(new Date(Date.now() + 2e8 + 1800000)), status: 'open', appointmentId: null, bookedBy: null };
    await assertFails(setDoc(doc(db('member'), 'branches/B1/slots/S9'), s));
    await assertSucceeds(setDoc(doc(db('assistant'), 'branches/B1/slots/S9'), s));
  });
});

describe('confidential pastoral data', () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const a = ctx.firestore();
      await setDoc(doc(a, 'branches/B1/pastoralNotes/N'), { title: 'x', content: 'secret', createdBy: 'pastor' });
      await setDoc(doc(a, 'branches/B1/meetingNotes/C'), { title: 'x', confidential: true, createdBy: 'pastor' });
      await setDoc(doc(a, 'branches/B1/meetingNotes/O'), { title: 'y', confidential: false, createdBy: 'pastor' });
      await setDoc(doc(a, 'branches/B1/prayers/P'), { kind: 'prayer', content: 'x', confidential: true, status: 'new', submittedBy: 'member' });
    });
  });
  it('private notes: pastor only, not even admin', async () => {
    await assertSucceeds(getDoc(doc(db('pastor'), 'branches/B1/pastoralNotes/N')));
    await assertFails(getDoc(doc(db('admin'), 'branches/B1/pastoralNotes/N')));
    await assertFails(getDoc(doc(db('assistant'), 'branches/B1/pastoralNotes/N')));
  });
  it('confidential meeting notes hidden from the assistant', async () => {
    await assertFails(getDoc(doc(db('assistant'), 'branches/B1/meetingNotes/C')));
    await assertSucceeds(getDoc(doc(db('assistant'), 'branches/B1/meetingNotes/O')));
    await assertFails(getDoc(doc(db('admin'), 'branches/B1/meetingNotes/O')));
  });
  it('confidential prayer requests: pastor and submitter only', async () => {
    await assertSucceeds(getDoc(doc(db('pastor'), 'branches/B1/prayers/P')));
    await assertSucceeds(getDoc(doc(db('member'), 'branches/B1/prayers/P')));
    await assertFails(getDoc(doc(db('assistant'), 'branches/B1/prayers/P')));
    await assertFails(getDoc(doc(db('leader'), 'branches/B1/prayers/P')));
  });
});

describe('reports, tasks, audit', () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'branches/B1/reports/RP'), { leaderUid: 'leader', status: 'pending', answers: {}, timeline: [], fields: [] });
    });
  });
  it('leader submits own report; other leaders cannot read it', async () => {
    await assertFails(getDoc(doc(db('leader2'), 'branches/B1/reports/RP')));
    await assertSucceeds(updateDoc(doc(db('leader'), 'branches/B1/reports/RP'), { answers: { a: 1 }, status: 'submitted' }));
    await assertFails(updateDoc(doc(db('leader'), 'branches/B1/reports/RP'), { status: 'reviewed' }));
    await assertSucceeds(updateDoc(doc(db('assistant'), 'branches/B1/reports/RP'), { status: 'revision', reviewerNote: 'more detail' }));
  });
  it('assignees can only change task status', async () => {
    await setDoc(doc(db('pastor'), 'branches/B1/tasks/T'), { title: 't', assigneeUid: 'leader', createdBy: 'pastor', status: 'todo' });
    await assertSucceeds(updateDoc(doc(db('leader'), 'branches/B1/tasks/T'), { status: 'done' }));
    await assertFails(updateDoc(doc(db('leader'), 'branches/B1/tasks/T'), { assigneeUid: 'member' }));
    await assertFails(getDoc(doc(db('member'), 'branches/B1/tasks/T')));
  });
  it('audit history is append-only', async () => {
    await assertSucceeds(setDoc(doc(db('member'), 'branches/B1/audit/X'), { action: 'a', actorUid: 'member' }));
    await assertFails(setDoc(doc(db('member'), 'branches/B1/audit/Y'), { action: 'a', actorUid: 'pastor' }));
    await assertFails(updateDoc(doc(db('member'), 'branches/B1/audit/X'), { action: 'b' }));
    await assertFails(getDoc(doc(db('member'), 'branches/B1/audit/X')));
    await assertFails(deleteDoc(doc(db('admin'), 'branches/B1/audit/X')));
  });
});

describe('public visitors (anonymous, no account)', () => {
  const anon = (id) => env.authenticatedContext(id, { firebase: { sign_in_provider: 'anonymous' } }).firestore();
  const enable = (data) => env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), 'branches/B1/settings/public'), data); });
  async function slot() {
    let s;
    await env.withSecurityRulesDisabled(async (ctx) => { s = (await getDoc(doc(ctx.firestore(), 'branches/B1/slots/S1'))).data(); });
    return s;
  }
  async function publicBook(d, id, apptId, extra = {}) {
    const s = await slot();
    const b = writeBatch(d);
    b.set(doc(d, 'branches/B1/appointments', apptId), {
      slotId: 'S1', start: s.start, end: s.end, bookedBy: id, attendeeUid: id, attendeeName: 'Visitor Name', phone: '08030000000',
      email: '', purpose: 'Counsel', status: 'booked', source: 'public', ...extra,
    });
    b.update(doc(d, 'branches/B1/slots/S1'), { status: 'booked', appointmentId: apptId, bookedBy: id });
    b.set(doc(d, 'throttle', id), { at: serverTimestamp() });
    return b.commit();
  }
  function publicPrayer(d, id, content = 'Please pray for my family') {
    const b = writeBatch(d);
    b.set(doc(collection(d, 'branches/B1/prayers')), { kind: 'prayer', content, name: '', phone: '', confidential: true, anonymous: true, status: 'new', source: 'public', submittedBy: id });
    b.set(doc(d, 'throttle', id), { at: serverTimestamp() });
    return b.commit();
  }

  it('nothing is possible until the office switches it on', async () => {
    await assertFails(getDocs(query(collection(anon('v1'), 'branches/B1/slots'), where('status', '==', 'open'))));
    await assertFails(publicPrayer(anon('v1'), 'v1'));
    await assertFails(publicBook(anon('v1'), 'v1', 'PA1'));
  });
  it('visitors can see open slots only, book one, and nothing else', async () => {
    await enable({ bookingEnabled: true, prayerEnabled: false });
    const d = anon('v1');
    await assertSucceeds(getDocs(query(collection(d, 'branches/B1/slots'), where('status', '==', 'open'))));
    await assertFails(getDocs(collection(d, 'branches/B1/slots')));
    await assertFails(getDocs(collection(d, 'branches/B1/funds')));
    await assertFails(getDocs(collection(d, 'users')));
    await assertFails(getDocs(collection(d, 'branches/B1/appointments')));
    await assertSucceeds(publicBook(d, 'v1', 'PA1'));
    await assertSucceeds(getDoc(doc(d, 'branches/B1/appointments/PA1')));
    await assertFails(getDoc(doc(anon('v2'), 'branches/B1/appointments/PA1')));
    await assertFails(publicBook(anon('v2'), 'v2', 'PA2'));
  });
  it('bookings need a name and phone', async () => {
    await enable({ bookingEnabled: true });
    await assertFails(publicBook(anon('v1'), 'v1', 'PA1', { phone: '' }));
    await assertFails(publicBook(anon('v1'), 'v1', 'PA1', { attendeeName: '' }));
  });
  it('prayer requests are accepted and throttled to one a minute', async () => {
    await enable({ prayerEnabled: true });
    const d = anon('v3');
    await assertSucceeds(publicPrayer(d, 'v3'));
    await assertFails(publicPrayer(d, 'v3', 'second one straight away'));
    await assertFails(getDocs(collection(d, 'branches/B1/prayers')));
    await assertFails(publicPrayer(anon('v4'), 'v4', 'x'.repeat(5000)));
  });
  it('visitors cannot create notifications, tasks or audit entries', async () => {
    await enable({ bookingEnabled: true, prayerEnabled: true });
    const d = anon('v5');
    await assertFails(setDoc(doc(d, 'branches/B1/notifications/N'), { toUid: 'pastor', fromUid: 'v5', read: false }));
    await assertFails(setDoc(doc(d, 'branches/B1/tasks/T'), { title: 'x', createdBy: 'v5', assigneeUid: 'pastor' }));
    await assertFails(setDoc(doc(d, 'branches/B1/audit/A'), { action: 'x', actorUid: 'v5' }));
    await assertFails(setDoc(doc(d, 'branches/B1/settings/public'), { bookingEnabled: true }));
  });
});
