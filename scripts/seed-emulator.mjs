// Seeds the LOCAL FIREBASE EMULATOR with realistic demo data covering every workflow.
// It refuses to run against a real project. Usage:
//   npm run emulators            (terminal 1)
//   npm run seed:emulator        (terminal 2)
// All demo accounts use the password: Password123!
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { applyLedger } from '../src/lib/finance.js';
import { STANDARD_TEMPLATES } from '../src/lib/reportTemplates.js';

process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
const PROJECT = process.env.GCLOUD_PROJECT || 'demo-orp';
if (!PROJECT.startsWith('demo-')) {
  console.error('Refusing to seed: project id must start with "demo-" (emulator only).');
  process.exit(1);
}

initializeApp({ projectId: PROJECT });
const auth = getAuth();
const db = getFirestore();
const PASSWORD = 'Password123!';
const now = new Date();
const day = (n, h = 9, m = 0) => { const d = new Date(now); d.setDate(d.getDate() + n); d.setHours(h, m, 0, 0); return d; };
const T = (d) => Timestamp.fromDate(d);
const naira = (n) => Math.round(n * 100);

const PEOPLE = [
  { key: 'admin', name: 'Femi Adeyemi', email: 'admin@orp.test', roles: ['admin'] },
  { key: 'pastor', name: 'Pastor Samuel Okafor', email: 'pastor@orp.test', roles: ['pastor'] },
  { key: 'assistant', name: 'Grace Bello', email: 'assistant@orp.test', roles: ['assistant'] },
  { key: 'finance', name: 'Musa Ibrahim', email: 'finance@orp.test', roles: ['finance'] },
  { key: 'youth', name: 'Tobi Adewale', email: 'youth@orp.test', roles: ['leader'], ministry: 'youth' },
  { key: 'choir', name: 'Chioma Nwosu', email: 'choir@orp.test', roles: ['leader'], ministry: 'choir' },
  { key: 'ushers', name: 'Kunle Oyelaran', email: 'ushers@orp.test', roles: ['leader'], ministry: 'ushers' },
  { key: 'children', name: 'Blessing Eze', email: 'children@orp.test', roles: ['leader'], ministry: 'children' },
  { key: 'member', name: 'Aisha Danjuma', email: 'member@orp.test', roles: ['member'] },
];
const MINISTRIES = { youth: 'Youth Ministry', choir: 'Choir', ushers: 'Ushering & Protocol', children: "Children's Church", welfare: 'Welfare Committee' };

const U = {};
async function users() {
  for (const p of PEOPLE) {
    let rec;
    try { rec = await auth.getUserByEmail(p.email); } catch { rec = await auth.createUser({ email: p.email, password: PASSWORD, displayName: p.name }); }
    U[p.key] = { uid: rec.uid, name: p.name };
  }
  for (const [id, name] of Object.entries(MINISTRIES)) {
    const leader = PEOPLE.find((p) => p.ministry === id);
    await db.doc(`ministries/${id}`).set({ name, leaderUid: leader ? U[leader.key].uid : '', createdAt: FieldValue.serverTimestamp() });
  }
  for (const p of PEOPLE) {
    await db.doc(`users/${U[p.key].uid}`).set({
      name: p.name, email: p.email, phone: '0803 000 0000', roles: p.roles, active: true,
      ministryId: p.ministry || '', ministryName: p.ministry ? MINISTRIES[p.ministry] : '', createdAt: FieldValue.serverTimestamp(),
    });
  }
  await db.doc('settings/public').set({ bookingEnabled: true, prayerEnabled: true, officePhone: '0803 555 0100', welcomeNote: '', bookingNote: '', prayerNote: '', bookingDays: 21 });
  await db.doc('meta/setup').set({ adminUid: U.admin.uid, at: FieldValue.serverTimestamp() });
  // one person waiting for activation
  let pend;
  try { pend = await auth.getUserByEmail('newvolunteer@orp.test'); } catch { pend = await auth.createUser({ email: 'newvolunteer@orp.test', password: PASSWORD, displayName: 'Ifeoma Obi' }); }
  await db.doc(`users/${pend.uid}`).set({ name: 'Ifeoma Obi', email: 'newvolunteer@orp.test', phone: '', roles: [], active: false, ministryId: '', createdAt: FieldValue.serverTimestamp() });
}

const tl = (who, action, note = '', d = now) => ({ at: T(d), by: U[who].uid, byName: U[who].name, action, note });

async function finance() {
  const funds = {
    general: { name: 'General Ministry Operations 2026', description: 'Day-to-day running of the Resident Pastor\'s office' },
    welfare: { name: 'Welfare', description: 'Support for members in need' },
    youth: { name: 'Youth Ministry', description: 'Youth programmes and retreat' },
    building: { name: 'Building Maintenance', description: 'Repairs and facility upkeep' },
  };
  const state = {};
  for (const [id, f] of Object.entries(funds)) {
    state[id] = { allocated: 0, committed: 0, paid: 0 };
    await db.doc(`funds/${id}`).set({ ...f, active: true, allocated: 0, committed: 0, paid: 0, lastTxId: null, createdBy: U.finance.uid, createdAt: T(day(-60)), updatedAt: T(day(-60)) });
  }
  const reqs = {};
  async function ledger(type, fundId, amount, { reqId, who = 'finance', date = now, method = '', reference = '', note = '' } = {}) {
    const r = reqId ? reqs[reqId] : null;
    const amt = type === 'release' ? r.amount - r.paid - r.released : amount;
    const { fundPatch, requestPatch } = applyLedger(type, amt, state[fundId], r);
    Object.assign(state[fundId], fundPatch);
    const tx = db.collection('transactions').doc();
    await tx.set({ type, fundId, fundName: funds[fundId].name, requestId: reqId || null, requestTitle: r?.title || null, amount: amt, date: T(date), method, reference, note, createdBy: U[who].uid, createdByName: U[who].name, createdAt: T(date) });
    await db.doc(`funds/${fundId}`).update({ ...fundPatch, lastTxId: tx.id, updatedAt: T(date) });
    if (r) {
      Object.assign(r, requestPatch);
      const label = { commit: 'Approved', payment: 'Payment recorded', advance: 'Advance paid', refund: 'Refund recorded', release: 'Closed — unpaid balance released' }[type];
      r.timeline.push(tl(who, label, note, date));
      const extra = type === 'commit' ? { decidedBy: U.pastor.uid, decidedByName: U.pastor.name, decidedAt: T(date) } : {};
      await db.doc(`requests/${reqId}`).update({ ...requestPatch, ...extra, lastTxId: tx.id, timeline: r.timeline, updatedAt: T(date) });
    }
    await db.collection('audit').add({ action: `ledger.${type}`, entityType: reqId ? 'request' : 'fund', entityId: reqId || fundId, details: `${type} ₦${(amt / 100).toLocaleString()} — ${funds[fundId].name}`, actorUid: U[who].uid, actorName: U[who].name, at: T(date) });
  }
  async function request(id, who, fundId, title, amount, category, description, created, extra = {}) {
    reqs[id] = { title, amount: naira(amount), paid: 0, released: 0, status: 'pending', timeline: [tl(who, 'Submitted', '', created)] };
    await db.doc(`requests/${id}`).set({
      title, description, category, fundId, fundName: funds[fundId].name, amount: naira(amount), neededBy: T(day(10)),
      ministry: PEOPLE.find((p) => p.key === who)?.ministry ? MINISTRIES[PEOPLE.find((p) => p.key === who).ministry] : '',
      requestedBy: U[who].uid, requestedByName: U[who].name, status: 'pending', paid: 0, released: 0, lastTxId: null,
      decisionNote: '', timeline: reqs[id].timeline, createdAt: T(created), updatedAt: T(created), ...extra,
    });
  }

  await ledger('allocation', 'general', naira(2500000), { date: day(-60), note: 'Approved 2026 budget', reference: 'Board minute 14/2026' });
  await ledger('allocation', 'welfare', naira(800000), { date: day(-60), note: 'Approved 2026 budget' });
  await ledger('allocation', 'youth', naira(600000), { date: day(-60), note: 'Approved 2026 budget' });
  await ledger('allocation', 'building', naira(1200000), { date: day(-60), note: 'Approved 2026 budget' });
  await ledger('receipt', 'welfare', naira(185000), { date: day(-20), method: 'Bank transfer', reference: 'Special offering 21/09', note: 'Welfare Sunday special offering' });

  // completed
  await request('r-chairs', 'ushers', 'building', 'Replace 40 broken plastic chairs', 340000, 'Equipment', '40 chairs at ₦8,500 each from Ojota market. Three quotes attached by WhatsApp.', day(-40));
  await ledger('commit', 'building', naira(340000), { reqId: 'r-chairs', who: 'pastor', date: day(-38) });
  await ledger('payment', 'building', naira(340000), { reqId: 'r-chairs', date: day(-35), method: 'Bank transfer', reference: 'TRF/0921/4471' });
  // partly paid
  await request('r-retreat', 'youth', 'youth', 'Youth retreat — transport and feeding', 450000, 'Ministry programme', 'Two 18-seater buses (₦180,000) and feeding for 60 youths over two days (₦270,000).', day(-14));
  await ledger('commit', 'youth', naira(450000), { reqId: 'r-retreat', who: 'pastor', date: day(-12), note: 'Approved. Ensure receipts for feeding.' });
  await ledger('advance', 'youth', naira(180000), { reqId: 'r-retreat', date: day(-10), method: 'Bank transfer', reference: 'TRF/1003/1182', note: 'Advance for buses' });
  // approved, unpaid
  await request('r-generator', 'ushers', 'building', 'Generator servicing and new battery', 95000, 'Maintenance & repairs', 'Quarterly servicing of the 20kVA generator plus replacement battery.', day(-5));
  await ledger('commit', 'building', naira(95000), { reqId: 'r-generator', who: 'pastor', date: day(-3) });
  // welfare paid then partly refunded and closed
  await request('r-hospital', 'assistant', 'welfare', 'Hospital bill support — Bro. Chinedu', 150000, 'Welfare', 'Support toward surgery bill at LUTH for Bro. Chinedu (choir).', day(-25));
  await ledger('commit', 'welfare', naira(150000), { reqId: 'r-hospital', who: 'pastor', date: day(-24) });
  await ledger('payment', 'welfare', naira(150000), { reqId: 'r-hospital', date: day(-23), method: 'Bank transfer', reference: 'TRF/0919/0042' });
  await ledger('refund', 'welfare', naira(20000), { reqId: 'r-hospital', date: day(-15), method: 'Bank transfer', reference: 'Hospital refund', note: 'Hospital refunded overpayment' });
  await ledger('release', 'welfare', 0, { reqId: 'r-hospital', date: day(-15), note: 'Final bill settled' });
  // pending approval (dashboard inbox for the pastor)
  await request('r-uniforms', 'choir', 'general', 'Choir robes for Christmas service', 280000, 'Equipment', '14 robes at ₦20,000 each (tailor: Mama Ngozi Designs).', day(-2));
  await request('r-sound', 'youth', 'general', 'Wireless microphones (2)', 160000, 'Equipment', 'Two Shure wireless handheld microphones for youth service.', day(-1));
  await request('r-food', 'member', 'welfare', 'Food items for widows outreach', 120000, 'Outreach', 'Rice, beans, oil for 15 widows — outreach on the last Saturday of the month.', day(0, 8));
  // clarification
  await request('r-party', 'children', 'general', "Children's end-of-year party", 210000, 'Ministry programme', 'Party for 80 children.', day(-4));
  reqs['r-party'].timeline.push(tl('pastor', 'Clarification requested', 'Please break down the costs (food, gifts, decorations) and confirm the number of volunteers.', day(-3)));
  await db.doc('requests/r-party').update({ status: 'clarification', decisionNote: 'Please break down the costs (food, gifts, decorations) and confirm the number of volunteers.', decidedBy: U.pastor.uid, decidedByName: U.pastor.name, decidedAt: T(day(-3)), timeline: reqs['r-party'].timeline });
  // rejected
  await request('r-tv', 'member', 'general', 'Smart TV for the lobby', 520000, 'Equipment', '65-inch TV for announcements in the lobby.', day(-9));
  reqs['r-tv'].timeline.push(tl('pastor', 'Rejected', 'Not a priority this year. Let us revisit in the 2027 budget.', day(-8)));
  await db.doc('requests/r-tv').update({ status: 'rejected', decisionNote: 'Not a priority this year. Let us revisit in the 2027 budget.', decidedBy: U.pastor.uid, decidedByName: U.pastor.name, decidedAt: T(day(-8)), timeline: reqs['r-tv'].timeline });

  await db.collection('reconciliations').add({ fundId: null, scope: 'All funds', account: 'GTBank current', asOf: T(day(-30)), statementBalance: naira(4815000), bookBalance: naira(4815000), difference: 0, note: 'Matches September statement.', createdBy: U.finance.uid, createdByName: U.finance.name, createdAt: T(day(-29)) });
}

async function meetings() {
  const batch = db.batch();
  const slots = [];
  for (let d = 1; d <= 12; d++) {
    const date = day(d);
    if ([0, 6].includes(date.getDay())) continue;
    for (let m = 0; m < 6; m++) {
      const start = day(d, 10, 0); start.setMinutes(m * 30);
      const end = new Date(start.getTime() + 30 * 60000);
      const ref = db.collection('slots').doc();
      slots.push({ ref, start, end });
      batch.set(ref, { start: T(start), end: T(end), status: 'open', appointmentId: null, bookedBy: null, location: "Pastor's office", createdBy: U.assistant.uid, createdAt: T(day(-3)), updatedAt: T(day(-3)) });
    }
  }
  await batch.commit();
  const bookings = [
    [0, 'youth', 'Discuss youth retreat logistics and budget'],
    [2, 'member', 'Marriage counselling — pre-marital session'],
    [7, 'choir', 'Christmas carol service planning'],
    [13, 'finance', 'Monthly finance review'],
  ];
  for (const [i, who, purpose] of bookings) {
    const s = slots[i];
    const appt = db.collection('appointments').doc();
    await appt.set({ slotId: s.ref.id, start: T(s.start), end: T(s.end), bookedBy: U[who].uid, bookedByName: U[who].name, attendeeUid: U[who].uid, attendeeName: U[who].name, phone: '0803 000 0000', purpose, location: "Pastor's office", status: 'booked', createdAt: T(day(-1)), updatedAt: T(day(-1)) });
    await s.ref.update({ status: 'booked', appointmentId: appt.id, bookedBy: U[who].uid });
  }
  // a visitor booked by the assistant
  const v = slots[4];
  const va = db.collection('appointments').doc();
  await va.set({ slotId: v.ref.id, start: T(v.start), end: T(v.end), bookedBy: U.assistant.uid, bookedByName: U.assistant.name, attendeeUid: null, attendeeName: 'Mr. Adebayo (visitor)', phone: '0812 345 6789', purpose: 'New resident — wants to join the church and discuss baptism', location: "Pastor's office", status: 'booked', createdAt: T(day(-1)), updatedAt: T(day(-1)) });
  await v.ref.update({ status: 'booked', appointmentId: va.id, bookedBy: U.assistant.uid });
  // a past appointment with notes
  const pastStart = day(-6, 11); const pastEnd = new Date(pastStart.getTime() + 1800000);
  const ps = db.collection('slots').doc();
  const pa = db.collection('appointments').doc();
  await ps.set({ start: T(pastStart), end: T(pastEnd), status: 'booked', appointmentId: pa.id, bookedBy: U.ushers.uid, location: "Pastor's office", createdBy: U.assistant.uid, createdAt: T(day(-10)) });
  await pa.set({ slotId: ps.id, start: T(pastStart), end: T(pastEnd), bookedBy: U.ushers.uid, bookedByName: U.ushers.name, attendeeUid: U.ushers.uid, attendeeName: U.ushers.name, phone: '', purpose: 'Ushering rota and new protocol team', status: 'completed', createdAt: T(day(-10)) });
  await db.collection('meetingNotes').add({ title: 'Meeting with Ushering & Protocol', date: T(pastStart), attendees: 'Kunle Oyelaran, Grace Bello', appointmentId: pa.id,
    notes: 'Reviewed the Sunday rota. Ushers are stretched at the second service.', decisions: 'Recruit 6 new ushers by end of November\nTrain protocol team before Christmas services',
    confidential: false, createdBy: U.pastor.uid, createdByName: U.pastor.name, createdAt: T(pastStart), updatedAt: T(pastStart) });
  await db.collection('meetingNotes').add({ title: 'Counselling session — confidential', date: T(day(-12)), attendees: '', notes: 'Confidential counselling notes.', decisions: '', confidential: true, createdBy: U.pastor.uid, createdByName: U.pastor.name, createdAt: T(day(-12)), updatedAt: T(day(-12)) });
}

async function reports() {
  const tmplIds = [];
  for (const t of STANDARD_TEMPLATES) {
    const ref = db.collection('reportTemplates').doc();
    await ref.set({ ...t, active: true, createdBy: U.assistant.uid, createdAt: T(day(-50)) });
    tmplIds.push(ref.id);
  }
  const monthly = STANDARD_TEMPLATES[0];
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const thisMonth = now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const leaders = ['youth', 'choir', 'ushers', 'children'];
  const answers = {
    youth: { avg_attendance: 64, meetings_held: 5, new_members: 7, activities: 'Bible study series on Daniel; football outreach.', achievements: '7 new members; 3 baptism candidates.', challenges: 'Venue is too small for Friday meetings.', needs: 'Approval for the retreat budget.', next_plans: 'Youth retreat; career talk.' },
    choir: { avg_attendance: 28, meetings_held: 8, new_members: 2, activities: 'Rehearsals for the carol service.', achievements: 'Ministered at the harvest service.', challenges: 'Two keyboards need repair.', needs: 'New robes before Christmas.', next_plans: 'Carol service rehearsals.' },
    ushers: { avg_attendance: 22, meetings_held: 4, new_members: 0, activities: 'Sunday services and midweek.', achievements: 'Smooth harvest service.', challenges: 'Short-staffed at second service.', needs: 'Six more volunteers.', next_plans: 'Recruitment drive.' },
  };
  for (const who of leaders) {
    const m = PEOPLE.find((p) => p.key === who).ministry;
    const submitted = answers[who];
    const status = who === 'youth' ? 'reviewed' : who === 'children' ? 'pending' : 'submitted';
    await db.collection('reports').add({
      templateId: tmplIds[0], templateName: monthly.name, fields: monthly.fields, period: lastMonth, dueDate: T(day(-9, 23, 59)),
      ministryId: m, ministryName: MINISTRIES[m], leaderUid: U[who].uid, leaderName: U[who].name,
      status, answers: submitted && status !== 'pending' ? submitted : {}, reviewerNote: status === 'reviewed' ? 'Great growth. Let us discuss the venue.' : '',
      ...(status !== 'pending' ? { submittedAt: T(day(-11)) } : {}),
      ...(status === 'reviewed' ? { reviewedAt: T(day(-6)), reviewedBy: U.pastor.uid, reviewedByName: U.pastor.name } : {}),
      timeline: [tl('assistant', 'Requested', '', day(-30)), ...(status !== 'pending' ? [tl(who, 'Submitted', '', day(-11))] : []), ...(status === 'reviewed' ? [tl('pastor', 'Reviewed', '', day(-6))] : [])],
      createdBy: U.assistant.uid, createdAt: T(day(-30)), updatedAt: T(day(-6)),
    });
    await db.collection('reports').add({
      templateId: tmplIds[0], templateName: monthly.name, fields: monthly.fields, period: thisMonth, dueDate: T(day(20, 23, 59)),
      ministryId: m, ministryName: MINISTRIES[m], leaderUid: U[who].uid, leaderName: U[who].name,
      status: 'pending', answers: {}, reviewerNote: '', timeline: [tl('assistant', 'Requested', '', day(-1))],
      createdBy: U.assistant.uid, createdAt: T(day(-1)), updatedAt: T(day(-1)),
    });
  }
}

async function care() {
  const task = (title, assignee, creator, priority, due, status = 'todo', source = null, description = '') => db.collection('tasks').add({
    title, description, assigneeUid: U[assignee].uid, assigneeName: U[assignee].name, createdBy: U[creator].uid, createdByName: U[creator].name,
    priority, dueDate: due ? T(due) : null, status, source, progressNote: '', completedAt: status === 'done' ? T(day(-1)) : null, createdAt: T(day(-7)), updatedAt: T(day(-1)),
  });
  await task('Recruit 6 new ushers', 'ushers', 'pastor', 'high', day(25), 'in_progress', { type: 'meeting', id: 'x', label: 'Meeting with Ushering & Protocol' });
  await task('Get two quotes for Friday venue', 'youth', 'pastor', 'medium', day(-2), 'todo', null, 'From the Youth report: venue too small.');
  await task('Prepare December preaching calendar', 'assistant', 'pastor', 'high', day(5));
  await task('Update welfare beneficiaries list', 'assistant', 'pastor', 'low', day(14));
  await task('Send September bank statement to the pastor', 'finance', 'pastor', 'medium', day(-12), 'done');

  await db.collection('followups').add({ person: 'Bro. Chinedu Okeke', contact: '0806 111 2233', reason: 'Recovering after surgery', notes: 'Visit at home with the welfare team.', status: 'open', dueDate: T(day(1, 23, 59)), createdBy: U.pastor.uid, createdByName: U.pastor.name, createdAt: T(day(-6)), updatedAt: T(day(-6)) });
  await db.collection('followups').add({ person: 'The Adeyemi family', contact: '0809 555 1212', reason: 'Bereavement — condolence visit', notes: '', status: 'open', dueDate: T(day(-1, 23, 59)), createdBy: U.assistant.uid, createdByName: U.assistant.name, createdAt: T(day(-3)), updatedAt: T(day(-3)) });
  await db.collection('followups').add({ person: 'Sis. Ruth Akande', contact: '0802 444 9090', reason: 'New convert — discipleship class', notes: '', status: 'open', dueDate: T(day(6, 23, 59)), createdBy: U.assistant.uid, createdByName: U.assistant.name, createdAt: T(day(-2)), updatedAt: T(day(-2)) });

  const prayer = (kind, who, content, extra = {}) => db.collection('prayers').add({ kind, content, name: U[who].name, confidential: false, anonymous: false, status: 'new', submittedBy: U[who].uid, createdAt: T(day(-2)), updatedAt: T(day(-2)), ...extra });
  await prayer('prayer', 'member', 'Please pray for my mother\'s recovery — she was admitted on Monday.');
  await prayer('prayer', 'choir', 'Travelling mercies for our team going to Ibadan for the choir conference.', { status: 'praying' });
  await prayer('prayer', 'member', 'A personal matter I would like the Pastor alone to pray about.', { confidential: true });
  await prayer('testimony', 'youth', 'I got the job I have been praying for since January! Thank you church family.', { status: 'shared' });
  await prayer('testimony', 'ushers', 'My daughter passed her WAEC with distinctions.', { status: 'new' });

  await db.collection('pastoralNotes').add({ title: 'Reflections on leadership retreat', person: '', content: 'Private reflections — demo note visible only to the pastor.', date: T(day(-5)), createdBy: U.pastor.uid, createdAt: T(day(-5)), updatedAt: T(day(-5)) });

  const note = (to, from, title, body, link) => db.collection('notifications').add({ toUid: U[to].uid, fromUid: U[from].uid, fromName: U[from].name, title, body, link, read: false, createdAt: T(day(0, 8)) });
  await note('pastor', 'member', 'Approval needed: Food items for widows outreach', '₦120,000.00 requested by Aisha Danjuma', '/finance/requests/r-food');
  await note('finance', 'pastor', 'Approved for payment: Generator servicing and new battery', '₦95,000.00 from Building Maintenance', '/finance/requests/r-generator');
  await note('children', 'pastor', "Children's end-of-year party: Clarification requested", 'Please break down the costs.', '/finance/requests/r-party');
}

await users();
await finance();
await meetings();
await reports();
await care();
console.log(`Seeded ${PROJECT}. Sign in with any of:`);
for (const p of PEOPLE) console.log(`  ${p.email.padEnd(22)} ${p.roles.join(',').padEnd(10)} ${p.name}`);
console.log(`  newvolunteer@orp.test  (awaiting activation)\nPassword for all: ${PASSWORD}`);
process.exit(0);
