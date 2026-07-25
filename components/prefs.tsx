"use client";

// Shared boat + skill selection. Boat/skill choice persists to localStorage; a
// signed-in user's custom boats load from Firestore. One place resolves the
// selected boatId (built-in OR custom) to a BoatProfile, so the whole app scores
// against it without knowing whether it's custom.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { BOATS, BoatProfile, DEFAULT_BOAT_ID, DEFAULT_SKILL, Skill, getBoat } from "@/lib/boats";
import { BoatSpec, deriveBoatProfile } from "@/lib/boatSpecs";
import { loadCustomBoats } from "@/lib/userPrefs";
import { useAuth } from "./auth";

interface Prefs {
  boatId: string;
  skill: Skill;
  setBoatId: (id: string) => void;
  setSkill: (s: Skill) => void;
  customBoats: BoatSpec[];
  /** Built-in + custom boats, as resolved profiles (for the selector). */
  boats: BoatProfile[];
  /** The currently selected boat, resolved to a profile. */
  boat: BoatProfile;
  reloadBoats: () => Promise<void>;
}

const PrefsContext = createContext<Prefs | null>(null);

export function PrefsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [boatId, setBoatId] = useState(DEFAULT_BOAT_ID);
  const [skill, setSkill] = useState<Skill>(DEFAULT_SKILL);
  const [customBoats, setCustomBoats] = useState<BoatSpec[]>([]);

  useEffect(() => {
    // Hydrate from localStorage after mount (avoids an SSR hydration mismatch).
    const b = localStorage.getItem("boatId");
    const s = localStorage.getItem("skill") as Skill | null;
    /* eslint-disable react-hooks/set-state-in-effect */
    if (b) setBoatId(b);
    if (s === "beginner" || s === "intermediate" || s === "advanced") setSkill(s);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    localStorage.setItem("boatId", boatId);
  }, [boatId]);
  useEffect(() => {
    localStorage.setItem("skill", skill);
  }, [skill]);

  const reloadBoats = useCallback(async () => {
    if (user) setCustomBoats(await loadCustomBoats(user.uid));
  }, [user]);

  useEffect(() => {
    if (!user) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCustomBoats([]);
      return;
    }
    let live = true;
    loadCustomBoats(user.uid).then((b) => {
      if (live) setCustomBoats(b);
    });
    return () => {
      live = false;
    };
  }, [user]);

  const boats = useMemo(() => [...BOATS, ...customBoats.map(deriveBoatProfile)], [customBoats]);
  const boat = useMemo(() => boats.find((b) => b.id === boatId) ?? getBoat(boatId), [boats, boatId]);

  return (
    <PrefsContext.Provider value={{ boatId, skill, setBoatId, setSkill, customBoats, boats, boat, reloadBoats }}>
      {children}
    </PrefsContext.Provider>
  );
}

export function usePrefs(): Prefs {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error("usePrefs must be used within PrefsProvider");
  return ctx;
}
