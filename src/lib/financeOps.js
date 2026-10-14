import { runTransaction, doc, collection, serverTimestamp, writeBatch, Timestamp } from 'firebase/firestore';
import { db } from '../firebase.js';
import { applyLedger, TX_TYPES } from './finance.js';
import { formatNGN } from './money.js';
import { timelineEntry, addNotify } from './db.js';

function auditIn(tx, profile, action, entityType, entityId, details) {
  tx.set(doc(collection(db, 'audit')), {
    action, entityType, entityId, details: String(details || ''),
    actorUid: profile.uid, actorName: profile.name, at: serverTimestamp(),
  });
}

function notifyIn(tx, profile, toUid, title, body, link) {
  if (!toUid || toUid === profile.uid) return;
  tx.set(doc(collection(db, 'notifications')), {
    toUid, fromUid: profile.uid, fromName: profile.name, title, body: body || '', link: link || '/', read: false, createdAt: serverTimestamp(),
  });
}

export async function createFund(profile, { name, description }) {
  const ref = doc(collection(db, 'funds'));
  const batch = writeBatch(db);
  batch.set(ref, {
    name: name.trim(), description: (description || '').trim(), active: true,
    allocated: 0, committed: 0, paid: 0, lastTxId: null,
    createdBy: profile.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  batch.set(doc(collection(db, 'audit')), {
    action: 'fund.created', entityType: 'fund', entityId: ref.id, details: name,
    actorUid: profile.uid, actorName: profile.name, at: serverTimestamp(),
  });
  await batch.commit();
  return ref.id;
}

/**
 * Writes one ledger entry and updates the fund (and request) totals atomically.
 * type: allocation | receipt | commit | payment | advance | refund | release
 * extras: { date, method, reference, note, financeUids, requesterNote }
 */
export async function postLedger(profile, type, { fundId, requestId = null, amount, date, method = '', reference = '', note = '', notifyUids = [] }) {
  const txRef = doc(collection(db, 'transactions'));
  await runTransaction(db, async (t) => {
    const fundRef = doc(db, 'funds', fundId);
    const fundSnap = await t.get(fundRef);
    if (!fundSnap.exists()) throw new Error('Fund not found.');
    const fund = fundSnap.data();
    let req = null; let reqRef = null;
    if (requestId) {
      reqRef = doc(db, 'requests', requestId);
      const reqSnap = await t.get(reqRef);
      if (!reqSnap.exists()) throw new Error('Request not found.');
      req = reqSnap.data();
      if (req.fundId !== fundId) throw new Error('Request belongs to a different fund.');
    }
    const amt = type === 'release' && req ? req.amount - (req.paid || 0) - (req.released || 0) : amount;
    const { fundPatch, requestPatch } = applyLedger(type, amt, fund, req);

    t.set(txRef, {
      type, fundId, fundName: fund.name, requestId, requestTitle: req?.title || null,
      amount: amt, date: date ? Timestamp.fromDate(date) : Timestamp.now(),
      method, reference, note,
      createdBy: profile.uid, createdByName: profile.name, createdAt: serverTimestamp(),
    });
    t.update(fundRef, { ...fundPatch, lastTxId: txRef.id, updatedAt: serverTimestamp() });

    if (reqRef) {
      const label = {
        commit: 'Approved', payment: `Payment of ${formatNGN(amt)} recorded`, advance: `Advance of ${formatNGN(amt)} paid`,
        refund: `Refund of ${formatNGN(amt)} recorded`, release: `Closed — ${formatNGN(amt)} unpaid balance released`,
      }[type];
      const patch = {
        ...requestPatch, lastTxId: txRef.id, updatedAt: serverTimestamp(),
        timeline: [...(req.timeline || []), timelineEntry(profile, label, note)],
      };
      if (type === 'commit') Object.assign(patch, { decidedBy: profile.uid, decidedByName: profile.name, decidedAt: serverTimestamp(), decisionNote: note || '' });
      t.update(reqRef, patch);
      const link = `/finance/requests/${requestId}`;
      notifyIn(t, profile, req.requestedBy, `${req.title}: ${label}`, note, link);
      if (type === 'commit') {
        for (const u of notifyUids) notifyIn(t, profile, u, `Approved for payment: ${req.title}`, `${formatNGN(req.amount)} from ${fund.name}`, link);
      }
    }
    auditIn(t, profile, `ledger.${type}`, requestId ? 'request' : 'fund', requestId || fundId,
      `${TX_TYPES[type]} ${formatNGN(amt)} — ${fund.name}${req ? ` — ${req.title}` : ''}${reference ? ` (ref ${reference})` : ''}`);
  });
  return txRef.id;
}

export async function submitRequest(profile, data, pastorUids) {
  const ref = doc(collection(db, 'requests'));
  const batch = writeBatch(db);
  batch.set(ref, {
    title: data.title.trim(), description: data.description.trim(), category: data.category,
    fundId: data.fundId, fundName: data.fundName, amount: data.amount,
    neededBy: data.neededBy ? Timestamp.fromDate(data.neededBy) : null,
    ministry: data.ministry || '',
    requestedBy: profile.uid, requestedByName: profile.name,
    status: 'pending', paid: 0, released: 0, lastTxId: null,
    decisionNote: '', timeline: [timelineEntry(profile, 'Submitted')],
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  batch.set(doc(collection(db, 'audit')), {
    action: 'request.submitted', entityType: 'request', entityId: ref.id,
    details: `${data.title} — ${formatNGN(data.amount)}`, actorUid: profile.uid, actorName: profile.name, at: serverTimestamp(),
  });
  for (const u of pastorUids) addNotify(batch, profile, u, `Approval needed: ${data.title}`, `${formatNGN(data.amount)} requested by ${profile.name}`, `/finance/requests/${ref.id}`);
  await batch.commit();
  return ref.id;
}

export async function updateRequestByRequester(profile, req, changes, action, pastorUids = []) {
  const { note, ...patch } = changes;
  const batch = writeBatch(db);
  batch.update(doc(db, 'requests', req.id), {
    ...patch, updatedAt: serverTimestamp(),
    timeline: [...(req.timeline || []), timelineEntry(profile, action, note)],
  });
  batch.set(doc(collection(db, 'audit')), {
    action: `request.${patch.status === 'cancelled' ? 'cancelled' : 'updated'}`, entityType: 'request', entityId: req.id,
    details: action, actorUid: profile.uid, actorName: profile.name, at: serverTimestamp(),
  });
  if (patch.status === 'pending') {
    for (const u of pastorUids) addNotify(batch, profile, u, `Resubmitted for approval: ${patch.title || req.title}`, '', `/finance/requests/${req.id}`);
  }
  await batch.commit();
}

export async function pastorDecision(profile, req, status, note) {
  const batch = writeBatch(db);
  const label = status === 'rejected' ? 'Rejected' : 'Clarification requested';
  batch.update(doc(db, 'requests', req.id), {
    status, decisionNote: note, decidedBy: profile.uid, decidedByName: profile.name, decidedAt: serverTimestamp(),
    updatedAt: serverTimestamp(), timeline: [...(req.timeline || []), timelineEntry(profile, label, note)],
  });
  batch.set(doc(collection(db, 'audit')), {
    action: `request.${status}`, entityType: 'request', entityId: req.id, details: note,
    actorUid: profile.uid, actorName: profile.name, at: serverTimestamp(),
  });
  addNotify(batch, profile, req.requestedBy, `${req.title}: ${label}`, note, `/finance/requests/${req.id}`);
  await batch.commit();
}

export async function recordReconciliation(profile, data) {
  const batch = writeBatch(db);
  const ref = doc(collection(db, 'reconciliations'));
  batch.set(ref, { ...data, createdBy: profile.uid, createdByName: profile.name, createdAt: serverTimestamp() });
  batch.set(doc(collection(db, 'audit')), {
    action: 'reconciliation.recorded', entityType: 'reconciliation', entityId: ref.id,
    details: `${data.scope}: statement ${formatNGN(data.statementBalance)} vs records ${formatNGN(data.bookBalance)}`,
    actorUid: profile.uid, actorName: profile.name, at: serverTimestamp(),
  });
  await batch.commit();
}
