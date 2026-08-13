// Per-user alert preferences, stored at users/{uid} in the "sailing" Firestore
// database. Read/written client-side; security rules restrict access to the owner.

import { getFirestoreDb } from "./firebase";
import { Compass16 } from "./units";
import { DEFAULT_BOAT_ID, DEFAULT_SKILL, Skill } from "./boats";
import { BoatSpec } from "./boatSpecs";

export interface AlertRules {
  /** Notify when a watched harbor turns green for this boat + skill (uses rate()). */
  notifyWhenGreen: boolean;
  /** Only alert if sustained wind is at or below this (kt). null = no limit. */
  maxWindKt: number | null;
  maxGustKt: number | null;
  /** Only alert when the wind is coming FROM one of these sectors. null = any. */
  windDirFrom: Compass16[] | null;
  maxWaveFt: number | null;
}

export interface AlertPrefs {
  email: string;
  displayName: string | null;
  boatId: string;
  skill: Skill;
  watchedHarbors: string[];
  rules: AlertRules;
  channels: { email: boolean; push: boolean };
  updatedAt: number;
}

export function defaultPrefs(email: string, displayName: string | null): AlertPrefs {
  return {
    email,
    displayName,
    boatId: DEFAULT_BOAT_ID,
    skill: DEFAULT_SKILL,
    watchedHarbors: [],
    rules: { notifyWhenGreen: true, maxWindKt: null, maxGustKt: null, windDirFrom: null, maxWaveFt: null },
    channels: { email: true, push: false },
    updatedAt: Date.now(),
  };
}

/** The user's doc plus the reader/writer, with the Firestore SDK loaded on demand.
 *  Dynamic rather than a static import so the ~4 s parse never lands in the server
 *  bundle — see the note in lib/firebase.ts. Every caller here is already async. */
async function userDoc(uid: string) {
  const [{ doc, getDoc, setDoc }, db] = await Promise.all([import("firebase/firestore"), getFirestoreDb()]);
  return { ref: doc(db, "users", uid), getDoc, setDoc };
}

export async function loadPrefs(uid: string): Promise<AlertPrefs | null> {
  const { ref, getDoc } = await userDoc(uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  const data = snap.data();
  // The user doc may hold only customBoats (no alert prefs yet) — treat that as "no prefs".
  return data.rules !== undefined || data.watchedHarbors !== undefined ? (data as AlertPrefs) : null;
}

// merge so writing alert prefs and writing custom boats never clobber each other.
export async function savePrefs(uid: string, prefs: AlertPrefs): Promise<void> {
  const { ref, setDoc } = await userDoc(uid);
  await setDoc(ref, { ...prefs, updatedAt: Date.now() }, { merge: true });
}

/** Custom boats live on the same users/{uid} doc (own-document rule already covers it). */
export async function loadCustomBoats(uid: string): Promise<BoatSpec[]> {
  const { ref, getDoc } = await userDoc(uid);
  const snap = await getDoc(ref);
  return snap.exists() ? ((snap.data().customBoats as BoatSpec[]) ?? []) : [];
}

export async function saveCustomBoats(uid: string, boats: BoatSpec[]): Promise<void> {
  const { ref, setDoc } = await userDoc(uid);
  await setDoc(ref, { customBoats: boats }, { merge: true });
}

/** Favorite harbor ids live on the same users/{uid} doc (own-document rule covers it). */
export async function loadFavorites(uid: string): Promise<string[]> {
  const { ref, getDoc } = await userDoc(uid);
  const snap = await getDoc(ref);
  return snap.exists() ? ((snap.data().favorites as string[]) ?? []) : [];
}

export async function saveFavorites(uid: string, ids: string[]): Promise<void> {
  const { ref, setDoc } = await userDoc(uid);
  await setDoc(ref, { favorites: ids }, { merge: true });
}
