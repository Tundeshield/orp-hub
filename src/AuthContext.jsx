import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, sendPasswordResetEmail, updateProfile,
} from 'firebase/auth';
import { arrayUnion, collection, doc, getDoc, onSnapshot, serverTimestamp, updateDoc, writeBatch } from 'firebase/firestore';
import { auth, db } from './firebase.js';
import { resetUsersCache } from './lib/users.js';
import { setCurrentBranch } from './lib/db.js';

const Ctx = createContext(null);
const LS_KEY = 'pd.branch';

function lsGet() { try { return localStorage.getItem(LS_KEY); } catch { return null; } }
function lsSet(v) { try { localStorage.setItem(LS_KEY, v); } catch { /* private mode */ } }

/**
 * Signed-in account (users/{uid}) + branches + membership of the current branch.
 * `profile` merges them into what the rest of the app uses: name, roles, active…
 * Roles are per branch; super admins act as admins in every branch.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined);
  const [account, setAccount] = useState(undefined);
  const [branches, setBranches] = useState(undefined);
  const [branchId, setBranchId] = useState(lsGet());
  const [member, setMember] = useState(undefined);

  useEffect(() => onAuthStateChanged(auth, (u) => { resetUsersCache(); setUser(u); }), []);

  // Account document
  useEffect(() => {
    setAccount(undefined);
    if (!user || user.isAnonymous) { setAccount(null); return undefined; }
    return onSnapshot(doc(db, 'users', user.uid),
      (snap) => setAccount(snap.exists() ? { uid: user.uid, ...snap.data() } : null),
      () => setAccount(null));
  }, [user]);

  // Branch list (names are visible to every signed-in user, e.g. for joining)
  useEffect(() => {
    setBranches(undefined);
    if (!user || user.isAnonymous) { setBranches([]); return undefined; }
    return onSnapshot(collection(db, 'branches'),
      (snap) => setBranches(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.name.localeCompare(b.name))),
      (e) => { console.error(e); setBranches([]); });
  }, [user]);

  // Legacy upgrade: the person who first set up the app (before branches) becomes super admin.
  useEffect(() => {
    if (!account || account.superAdmin) return;
    getDoc(doc(db, 'meta', 'setup')).then((s) => {
      if (s.exists() && s.data().adminUid === account.uid) {
        updateDoc(doc(db, 'users', account.uid), { superAdmin: true, updatedAt: serverTimestamp() }).catch(console.error);
      }
    }).catch(() => {});
  }, [account]);

  const superAdmin = !!account?.superAdmin;
  const accessible = useMemo(() => {
    if (!branches || !account) return [];
    if (superAdmin) return branches;
    const mine = new Set(account.branchIds || []);
    return branches.filter((b) => mine.has(b.id));
  }, [branches, account, superAdmin]);

  // Pick the current branch
  const current = useMemo(() => {
    if (!accessible.length) return null;
    const pref = [branchId, account?.currentBranch].find((id) => id && accessible.some((b) => b.id === id));
    return accessible.find((b) => b.id === pref) || accessible[0];
  }, [accessible, branchId, account]);
  if (user && !user.isAnonymous) setCurrentBranch(current?.id || null);

  // Membership in the current branch
  useEffect(() => {
    setMember(undefined);
    if (!user || !current) { setMember(null); return undefined; }
    return onSnapshot(doc(db, 'branches', current.id, 'members', user.uid),
      (snap) => setMember(snap.exists() ? snap.data() : null),
      () => setMember(null));
  }, [user, current]);

  const profile = useMemo(() => {
    if (!account) return null;
    const memberActive = !!member?.active;
    const roles = new Set(memberActive ? member.roles || [] : []);
    if (superAdmin) roles.add('admin');
    return {
      uid: account.uid,
      name: member?.name || account.name,
      email: account.email,
      phone: member?.phone || account.phone || '',
      roles: [...roles],
      active: superAdmin || memberActive,
      isMember: !!member,
      memberPending: !!member && !memberActive,
      ministryId: member?.ministryId || '',
      ministryName: member?.ministryName || '',
      isSuperAdmin: superAdmin,
      branchId: current?.id || null,
      branchName: current?.name || '',
    };
  }, [account, member, superAdmin, current]);

  async function ensureAccount(u, name) {
    const snap = await getDoc(doc(db, 'users', u.uid));
    if (snap.exists()) return;
    const setup = await getDoc(doc(db, 'meta', 'setup'));
    const batch = writeBatch(db);
    const base = { name: name || u.displayName || u.email, email: u.email, phone: '', branchIds: [], createdAt: serverTimestamp() };
    if (!setup.exists()) {
      batch.set(doc(db, 'users', u.uid), { ...base, superAdmin: true });
      batch.set(doc(db, 'meta', 'setup'), { adminUid: u.uid, at: serverTimestamp() });
    } else {
      batch.set(doc(db, 'users', u.uid), base);
    }
    await batch.commit();
  }

  const value = {
    user,
    account,
    profile,
    branches: branches || [],
    accessibleBranches: accessible,
    branch: current,
    loading: user === undefined || (user && !user.isAnonymous && (account === undefined || branches === undefined || (current && member === undefined))),
    async signIn(email, password) {
      const { user: u } = await signInWithEmailAndPassword(auth, email, password);
      await ensureAccount(u);
    },
    async signUp(name, email, password) {
      const { user: u } = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(u, { displayName: name });
      await ensureAccount(u, name);
    },
    resetPassword: (email) => sendPasswordResetEmail(auth, email),
    signOut: () => signOut(auth),
    retryProfile: () => user && ensureAccount(user),
    switchBranch(id) {
      lsSet(id);
      setBranchId(id);
      if (account) updateDoc(doc(db, 'users', account.uid), { currentBranch: id, updatedAt: serverTimestamp() }).catch(() => {});
    },
    // Ask to join a branch: creates a pending membership the branch admin activates.
    async joinBranch(id) {
      const batch = writeBatch(db);
      batch.set(doc(db, 'branches', id, 'members', account.uid), {
        name: account.name, email: account.email, phone: account.phone || '', roles: [], active: false,
        ministryId: '', ministryName: '', createdAt: serverTimestamp(),
      });
      batch.update(doc(db, 'users', account.uid), { branchIds: arrayUnion(id), currentBranch: id, updatedAt: serverTimestamp() });
      await batch.commit();
      lsSet(id);
      setBranchId(id);
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
