// Firebase client SDK init. The web config below is PUBLIC client config (the
// apiKey is not a secret — access is controlled by Firebase Auth + Firestore
// security rules, see firestore.rules). Auth + user data live in a DEDICATED
// Firebase project (chicago-harbor-sailing-app), separate from the hosting
// project (mootek-consulting) — full isolation of the sailing app's user pool.

import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDbDE9tA8QTleDfm4YVSr2cy8Ix7uEcbjg",
  authDomain: "chicago-harbor-sailing-app.firebaseapp.com",
  projectId: "chicago-harbor-sailing-app",
  storageBucket: "chicago-harbor-sailing-app.firebasestorage.app",
  messagingSenderId: "565915850456",
  appId: "1:565915850456:web:5cf9f7e2bcb6e0c26c29ad",
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();
