import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { initializeFirestore, connectFirestoreEmulator } from 'firebase/firestore';

const env = import.meta.env;

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

export const isConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);
export const useEmulators = env.VITE_USE_EMULATORS === 'true';
export const churchName = env.VITE_CHURCH_NAME || 'Office of the Resident Pastor';

let app, auth, db;
if (isConfigured) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  // In-memory cache only: confidential pastoral data must not persist on shared computers.
  db = initializeFirestore(app, {});
  if (useEmulators) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
  }
}

export { app, auth, db };
