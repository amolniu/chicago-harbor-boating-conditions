// Firebase client SDK init. The web config below is PUBLIC client config (the
// apiKey is not a secret — access is controlled by Firebase Auth + Firestore
// security rules, see firestore.rules). User data lives in the dedicated
// "sailing" Firestore database, isolated from the rest of the project.

import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCbCZNsHnMUGpEJGhbLBqXIGt1yuQ67SEc",
  authDomain: "mootek-consulting.firebaseapp.com",
  projectId: "mootek-consulting",
  storageBucket: "mootek-consulting.firebasestorage.app",
  messagingSenderId: "80451765683",
  appId: "1:80451765683:web:4e893a13ad9c95fd4137c6",
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app, "sailing");
export const googleProvider = new GoogleAuthProvider();
