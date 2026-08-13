// Firebase client SDK init. The web config below is PUBLIC client config (the
// apiKey is not a secret — access is controlled by Firebase Auth + Firestore
// security rules, see firestore.rules). Auth + user data live in a DEDICATED
// Firebase project (chicago-harbor-sailing-app), separate from the hosting
// project (mootek-consulting) — full isolation of the sailing app's user pool.
//
// Firestore is loaded with a DYNAMIC import, and that is load-bearing rather than
// stylistic. Client components are still server-rendered, so a static
// `import "firebase/firestore"` puts it in the server's module graph — and importing
// it costs ~4 s in Node (measured; app and auth are ~220 ms each, and the
// initializeApp/getAuth/getFirestore calls themselves are ~1 ms). Firebase's deploy
// step loads the SSR entry to work out what to deploy and allows 10 s, so that one
// import was most of the budget for a module the server never actually uses.
// Everything here is called only from effects and event handlers, never at import.

import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import type { Firestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDbDE9tA8QTleDfm4YVSr2cy8Ix7uEcbjg",
  authDomain: "chicago-harbor-sailing-app.firebaseapp.com",
  projectId: "chicago-harbor-sailing-app",
  storageBucket: "chicago-harbor-sailing-app.firebasestorage.app",
  messagingSenderId: "565915850456",
  appId: "1:565915850456:web:5cf9f7e2bcb6e0c26c29ad",
};

function app(): FirebaseApp {
  return getApps().length ? getApp() : initializeApp(firebaseConfig);
}

export const auth = getAuth(app());
export const googleProvider = new GoogleAuthProvider();

let dbPromise: Promise<Firestore> | null = null;

/** The Firestore handle, loading the SDK on first use. Memoised, so the ~4 s import
 *  happens at most once and only in the browser, where it's actually needed. */
export function getFirestoreDb(): Promise<Firestore> {
  return (dbPromise ??= import("firebase/firestore").then(({ getFirestore }) => getFirestore(app())));
}
