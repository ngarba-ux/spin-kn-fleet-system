// Firebase client setup. The web config is public by design; access is
// controlled by Auth, security rules and the Cloud Functions.
import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';
import { connectStorageEmulator, getStorage } from 'firebase/storage';

const config = {
  apiKey: 'AIzaSyDc3YRvJ_P2eq0z34PmD63HSg8kp05dRbA',
  authDomain: 'spin-kn-fleet.firebaseapp.com',
  projectId: 'spin-kn-fleet',
  storageBucket: 'spin-kn-fleet.firebasestorage.app',
  messagingSenderId: '285522850455',
  appId: '1:285522850455:web:f95154ead1e05b7d556fd2',
};

export const app = initializeApp(config);
export const auth = getAuth(app);
// Offline cache: reads come from the device when there is no signal, and
// writes (the driver action queue) are kept and uploaded later.
export const db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
export const functions = getFunctions(app, 'europe-west1');
export const storage = getStorage(app);

if (import.meta.env.VITE_USE_EMULATORS === 'true') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
  connectStorageEmulator(storage, '127.0.0.1', 9199);
}

export class CallError extends Error {
  constructor(message: string, public code: string, public details?: unknown) { super(message); }
}

// Calls a Cloud Function and turns its errors into readable messages.
export async function call<T = unknown>(name: string, data?: unknown): Promise<T> {
  try {
    const res = await httpsCallable(functions, name, { timeout: 60_000 })(data);
    return res.data as T;
  } catch (e) {
    const err = e as { code?: string; message?: string; details?: unknown };
    const code = (err.code ?? 'unknown').replace(/^functions\//, '');
    const message = code === 'unavailable' || (code === 'internal' && !navigator.onLine)
      ? 'No connection. Check your network and try again.'
      : err.message ?? 'Something went wrong.';
    throw new CallError(message, code, err.details);
  }
}
