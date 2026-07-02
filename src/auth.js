import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  deleteUser,
  onAuthStateChanged,
  sendEmailVerification,
  applyActionCode
} from 'firebase/auth';
import { auth } from './firebase.js';

const googleProvider = new GoogleAuthProvider();

export async function signUp(email, password) {
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  if (credential.user) {
    const actionCodeSettings = {
      // Redirects user back to this exact deployed app URL after verification
      url: window.location.origin + window.location.pathname,
      handleCodeInApp: false
    };
    await sendEmailVerification(credential.user, actionCodeSettings);
  }
  return credential;
}

export function signIn(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export function resendVerificationEmail() {
  if (auth.currentUser) {
    const actionCodeSettings = {
      url: window.location.origin + window.location.pathname,
      handleCodeInApp: false
    };
    return sendEmailVerification(auth.currentUser, actionCodeSettings);
  }
  return Promise.reject(new Error('No authenticated user session found.'));
}

export function verifyEmailCode(oobCode) {
  return applyActionCode(auth, oobCode);
}

export function signInWithGoogle() {
  return signInWithPopup(auth, googleProvider);
}

export function signOutUser() {
  return signOut(auth);
}

// Permanently deletes the currently signed-in Firebase Auth user.
export function deleteAccount() {
  if (!auth.currentUser) return Promise.reject(new Error('No signed-in user'));
  return deleteUser(auth.currentUser);
}

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

// Maps Firebase Auth error codes to human-readable messages for inline form errors.
export function authErrorMessage(error) {
  const code = error && error.code;
  const messages = {
    'auth/email-already-in-use': 'An account with that email already exists.',
    'auth/invalid-email': 'That email address looks invalid.',
    'auth/weak-password': 'Password should be at least 6 characters.',
    'auth/wrong-password': 'Incorrect email or password.',
    'auth/user-not-found': 'Incorrect email or password.',
    'auth/invalid-credential': 'Incorrect email or password.',
    'auth/too-many-requests': 'Too many attempts. Please wait a moment and try again.',
    'auth/popup-closed-by-user': 'Google sign-in was cancelled.',
    'auth/cancelled-popup-request': 'Google sign-in was cancelled.',
    'auth/invalid-api-key': 'App is not configured with a valid Firebase project yet.',
    'auth/network-request-failed': 'Network error. Check your connection and try again.',
    'auth/requires-recent-login': 'For security, please log out and log back in before deleting your account.'
  };
  return messages[code] || 'Something went wrong. Please try again.';
}
