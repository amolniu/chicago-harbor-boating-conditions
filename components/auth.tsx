"use client";

// Firebase Auth context. Client-side only: onAuthStateChanged drives the user.
// Google sign-in uses a POPUP on all platforms — the popup talks back via
// same-origin postMessage, so it survives Safari ITP / Brave shields. Redirect
// (the old "mobile" path) breaks on those browsers because the app domain and the
// auth-handler domain differ (auth lives in a separate Firebase project), and the
// redirect result gets blocked as cross-site storage. Email/password rounds it out.

import { createContext, useContext, useEffect, useState } from "react";
import {
  User,
  onAuthStateChanged,
  signInWithPopup,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  signOut as fbSignOut,
} from "firebase/auth";
import { auth, googleProvider } from "@/lib/firebase";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  signInGoogle: () => Promise<void>;
  signUpEmail: (email: string, password: string, name?: string) => Promise<void>;
  signInEmail: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(
    () =>
      onAuthStateChanged(auth, (u) => {
        setUser(u);
        setLoading(false);
      }),
    [],
  );

  const value: AuthContextValue = {
    user,
    loading,
    signInGoogle: async () => {
      await signInWithPopup(auth, googleProvider);
    },
    signUpEmail: async (email, password, name) => {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      if (name) await updateProfile(cred.user, { displayName: name });
    },
    signInEmail: async (email, password) => {
      await signInWithEmailAndPassword(auth, email, password);
    },
    signOut: async () => {
      await fbSignOut(auth);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

/** Human-friendly message for the common Firebase Auth error codes. */
export function authErrorMessage(err: unknown): string {
  const code = (err as { code?: string })?.code ?? "";
  switch (code) {
    case "auth/invalid-email":
      return "That email address doesn't look right.";
    case "auth/email-already-in-use":
      return "An account with this email already exists — try signing in.";
    case "auth/weak-password":
      return "Password should be at least 6 characters.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Email or password is incorrect.";
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "Sign-in was cancelled.";
    case "auth/popup-blocked":
    case "auth/operation-not-supported-in-this-environment":
      return "Your browser blocked the sign-in window — allow pop-ups for this site and try again.";
    case "auth/unauthorized-domain":
      return "This domain isn't authorized for sign-in yet (add it in the Firebase console).";
    case "auth/operation-not-allowed":
      return "This sign-in method isn't enabled yet (enable it in the Firebase console).";
    default:
      return "Something went wrong signing in. Please try again.";
  }
}
