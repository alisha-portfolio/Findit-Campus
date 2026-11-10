// Firebase app + Authentication.
//   - Visitors (students) are signed in ANONYMOUSLY, only at the moment they
//     submit a report or claim. They never see a login screen.
//   - Administrators sign in with email + password. Being an admin is decided
//     by the server-side security rules (a document in the `admins` collection),
//     never by this file.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, signInAnonymously, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  setPersistence, browserSessionPersistence,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { firebaseConfig } from './firebase-config.js';

export const isConfigured = !Object.values(firebaseConfig).some((v) => String(v).includes('YOUR_'));
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

/** Resolves with the current user (or null) once Firebase has restored any saved session. */
export function waitForAuth() {
  return new Promise((resolve) => {
    const off = onAuthStateChanged(auth, (u) => { off(); resolve(u); });
  });
}

/** Returns the signed-in user, signing in anonymously first if nobody is. */
export async function ensureUser() {
  const existing = await waitForAuth();
  if (existing) return existing;
  const cred = await signInAnonymously(auth);
  return cred.user;
}

/** Email + password sign-in. The admin session ends when the browser tab closes. */
export async function signInAdmin(email, password) {
  await signOut(auth); // Clear any existing anonymous or stale session first
  await setPersistence(auth, browserSessionPersistence);
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export const signOutUser = () => signOut(auth);

export function authErrorMessage(err) {
  switch (err?.code) {
    case 'auth/invalid-credential':
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-email':
      return 'Incorrect email or password.'; // one generic message, like the old backend
    case 'auth/too-many-requests': return 'Too many login attempts. Please wait a few minutes and try again.';
    case 'auth/network-request-failed': return 'Cannot reach the server. Check your internet connection and try again.';
    default: return err?.message || 'Sign-in failed. Please try again.';
  }
}
