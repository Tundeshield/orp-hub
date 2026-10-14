import { useEffect, useState } from 'react';
import { onSnapshot, query, where } from 'firebase/firestore';
import { col } from './db.js';

// Shared live list of active users (names for pickers and notification targets).
let cache = null;
let listeners = new Set();
let unsub = null;

function start() {
  if (unsub) return;
  unsub = onSnapshot(query(col('users'), where('active', '==', true)), (snap) => {
    cache = snap.docs.map((d) => ({ uid: d.id, ...d.data() })).sort((a, b) => a.name.localeCompare(b.name));
    listeners.forEach((l) => l(cache));
  }, (e) => { console.warn('users listener stopped', e.code); unsub = null; });
}

export function useUsers() {
  const [users, setUsers] = useState(cache || []);
  useEffect(() => {
    start();
    listeners.add(setUsers);
    if (cache) setUsers(cache);
    return () => { listeners.delete(setUsers); };
  }, []);
  return users;
}

export function usersWithRole(users, role) {
  return users.filter((u) => (u.roles || []).includes(role));
}

export function resetUsersCache() {
  if (unsub) unsub();
  unsub = null; cache = null; listeners = new Set();
}
