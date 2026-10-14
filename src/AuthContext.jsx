import { createContext, useContext, useEffect, useState } from 'react';
import {
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, sendPasswordResetEmail, updateProfile,
} from 'firebase/auth';
import { doc, getDoc, onSnapshot, serverTimestamp, writeBatch } from 'firebase/firestore';
import { auth, db } from './firebase.js';
import { resetUsersCache } from './lib/users.js';

const Ctx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined);
  const [profile, setProfile] = useState(undefined);

  useEffect(() => onAuthStateChanged(auth, (u) => { resetUsersCache(); setUser(u); if (!u) setProfile(null); }), []);

  useEffect(() => {
    if (!user) return undefined;
    setProfile(undefined);
    return onSnapshot(doc(db, 'users', user.uid),
      (snap) => setProfile(snap.exists() ? { uid: user.uid, ...snap.data() } : null),
      () => setProfile(null));
  }, [user]);

  async function ensureProfile(u, name) {
    const snap = await getDoc(doc(db, 'users', u.uid));
    if (snap.exists()) return;
    const setup = await getDoc(doc(db, 'meta', 'setup'));
    const batch = writeBatch(db);
    const base = { name: name || u.displayName || u.email, email: u.email, phone: '', ministryId: '', createdAt: serverTimestamp() };
    if (!setup.exists()) {
      // First account ever: becomes the administrator.
      batch.set(doc(db, 'users', u.uid), { ...base, roles: ['admin'], active: true });
      batch.set(doc(db, 'meta', 'setup'), { adminUid: u.uid, at: serverTimestamp() });
    } else {
      batch.set(doc(db, 'users', u.uid), { ...base, roles: [], active: false });
    }
    await batch.commit();
  }

  const value = {
    user, profile,
    loading: user === undefined || (user && profile === undefined),
    async signIn(email, password) {
      const { user: u } = await signInWithEmailAndPassword(auth, email, password);
      await ensureProfile(u);
    },
    async signUp(name, email, password) {
      const { user: u } = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(u, { displayName: name });
      await ensureProfile(u, name);
    },
    resetPassword: (email) => sendPasswordResetEmail(auth, email),
    signOut: () => signOut(auth),
    retryProfile: () => user && ensureProfile(user),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
