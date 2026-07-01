import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Firebase web config is not a secret — it's meant to be public. Security is
// enforced by Firestore Security Rules (see project docs), not by hiding this.
const firebaseConfig = {
  apiKey: 'AIzaSyCLsCSrKlkHXGA9zk7GUSS-vE8me9esBxw',
  authDomain: 'apex-wallet-870e1.firebaseapp.com',
  projectId: 'apex-wallet-870e1',
  storageBucket: 'apex-wallet-870e1.firebasestorage.app',
  messagingSenderId: '425402754744',
  appId: '1:425402754744:web:23396715401526623bb64d'
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
