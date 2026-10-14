import { useEffect, useState } from 'react';
import {
  collection, doc, onSnapshot, query, where, serverTimestamp, writeBatch, Timestamp,
} from 'firebase/firestore';
import { db } from '../firebase.js';

export { collection, doc, query, where, serverTimestamp, writeBatch, Timestamp, db };

// ---- branch scoping ----
// All church data lives under branches/{branchId}/... The current branch is set once by
// the auth/branch provider (or the public page) before any branch data is read.
let currentBranch = null;
export function setCurrentBranch(id) { currentBranch = id; }
export function getCurrentBranch() { return currentBranch; }
function need() {
  if (!currentBranch) throw new Error('No branch selected.');
  return currentBranch;
}
export const bcol = (name) => collection(db, 'branches', need(), name);
export const bdoc = (name, id) => (id === undefined ? doc(bcol(name)) : doc(db, 'branches', need(), name, id));

export const col = bcol;
export const ref = bdoc;
export const newId = (name) => doc(bcol(name)).id;

function mapSnap(snap) {
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Live query. Pass a factory returning a Firestore query (or null to skip) and deps.
export function useLive(factory, deps = []) {
  const [state, setState] = useState({ data: [], loading: true, error: null });
  useEffect(() => {
    const q = factory();
    if (!q) { setState({ data: [], loading: false, error: null }); return undefined; }
    setState((s) => ({ ...s, loading: true }));
    return onSnapshot(q, (snap) => setState({ data: mapSnap(snap), loading: false, error: null }),
      (error) => { console.error(error); setState({ data: [], loading: false, error }); });
     
  }, deps);
  return state;
}

export function useDoc(name, id) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  useEffect(() => {
    if (!id) { setState({ data: null, loading: false, error: null }); return undefined; }
    return onSnapshot(bdoc(name, id),
      (snap) => setState({ data: snap.exists() ? { id: snap.id, ...snap.data() } : null, loading: false, error: null }),
      (error) => { console.error(error); setState({ data: null, loading: false, error }); });
  }, [name, id]);
  return state;
}

export function timelineEntry(profile, action, note = '') {
  // serverTimestamp() is not allowed inside arrays, so use a client Timestamp.
  return { at: Timestamp.now(), by: profile.uid, byName: profile.name, action, note: note || '' };
}

// Adds an audit-log entry to a batch.
export function addAudit(batch, profile, action, entityType, entityId, details = '') {
  batch.set(doc(bcol('audit')), {
    action, entityType, entityId, details: String(details || ''),
    actorUid: profile.uid, actorName: profile.name, at: serverTimestamp(),
  });
}

// Adds an in-app notification to a batch (skips notifying yourself).
export function addNotify(batch, profile, toUid, title, body = '', link = '/') {
  if (!toUid || toUid === profile.uid) return;
  batch.set(doc(bcol('notifications')), {
    toUid, fromUid: profile.uid, fromName: profile.name, title, body, link, read: false, createdAt: serverTimestamp(),
  });
}

export function friendlyError(err) {
  const code = err?.code || '';
  if (code === 'permission-denied') return 'You don\'t have permission to do that, or the record changed. Refresh and try again.';
  if (code === 'unavailable') return 'You appear to be offline. Check your connection and try again.';
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') return 'Email or password is incorrect.';
  if (code === 'auth/email-already-in-use') return 'An account with this email already exists. Sign in instead.';
  if (code === 'auth/weak-password') return 'Use a password of at least 8 characters.';
  if (code === 'auth/too-many-requests') return 'Too many attempts. Wait a few minutes and try again.';
  if (code === 'auth/network-request-failed') return 'Network error. Check your connection.';
  return err?.message || 'Something went wrong. Please try again.';
}
