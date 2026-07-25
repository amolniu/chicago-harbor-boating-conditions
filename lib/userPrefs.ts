// Per-user alert preferences, stored at users/{uid} in the "sailing" Firestore
// database. Read/written client-side; security rules restrict access to the owner.

import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "./firebase";
import { Compass16 } from "./units";
import { DEFAULT_BOAT_ID, DEFAULT_SKILL, Skill } from "./boats";

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
  return snap.exists() ? (snap.data() as AlertPrefs) : null;
}

export async function savePrefs(uid: string, prefs: AlertPrefs): Promise<void> {
  await setDoc(doc(db, "users", uid), { ...prefs, updatedAt: Date.now() });
}
