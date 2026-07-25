// Per-user alert preferences, stored at users/{uid} in the "sailing" Firestore
// database. Read/written client-side; security rules restrict access to the owner.

import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "./firebase";
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

export async function loadPrefs(uid: string): Promise<AlertPrefs | null> {
  const snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists()) return null;
  const data = snap.data();
  // The user doc may hold only customBoats (no alert prefs yet) — treat that as "no prefs".
  return data.rules !== undefined || data.watchedHarbors !== undefined ? (data as AlertPrefs) : null;
}

// merge so writing alert prefs and writing custom boats never clobber each other.
export async function savePrefs(uid: string, prefs: AlertPrefs): Promise<void> {
  await setDoc(doc(db, "users", uid), { ...prefs, updatedAt: Date.now() }, { merge: true });
}

/** Custom boats live on the same users/{uid} doc (own-document rule already covers it). */
export async function loadCustomBoats(uid: string): Promise<BoatSpec[]> {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? ((snap.data().customBoats as BoatSpec[]) ?? []) : [];
}

export async function saveCustomBoats(uid: string, boats: BoatSpec[]): Promise<void> {
  await setDoc(doc(db, "users", uid), { customBoats: boats }, { merge: true });
}
