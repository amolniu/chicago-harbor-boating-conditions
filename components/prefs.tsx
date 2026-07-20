"use client";

// Shared boat + skill selection, persisted to localStorage so the whole app
// recomputes ratings instantly and remembers the user between visits.

import { createContext, useContext, useEffect, useState } from "react";
import { BOATS, DEFAULT_BOAT_ID, DEFAULT_SKILL, Skill } from "@/lib/boats";

interface Prefs {
  boatId: string;
  skill: Skill;
  setBoatId: (id: string) => void;
  setSkill: (s: Skill) => void;
}

const PrefsContext = createContext<Prefs | null>(null);

export function PrefsProvider({ children }: { children: React.ReactNode }) {
  const [boatId, setBoatId] = useState(DEFAULT_BOAT_ID);
  const [skill, setSkill] = useState<Skill>(DEFAULT_SKILL);

  useEffect(() => {
    // Hydrate from localStorage after mount — reading it during SSR would cause a
    // hydration mismatch, so the intentional pattern is default-render then update.
    const b = localStorage.getItem("boatId");
    const s = localStorage.getItem("skill") as Skill | null;
    /* eslint-disable react-hooks/set-state-in-effect */
    if (b && BOATS.some((x) => x.id === b)) setBoatId(b);
    if (s === "beginner" || s === "intermediate" || s === "advanced") setSkill(s);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    localStorage.setItem("boatId", boatId);
  }, [boatId]);
  useEffect(() => {
    localStorage.setItem("skill", skill);
  }, [skill]);

  return (
    <PrefsContext.Provider value={{ boatId, skill, setBoatId, setSkill }}>
      {children}
    </PrefsContext.Provider>
  );
}

export function usePrefs(): Prefs {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error("usePrefs must be used within PrefsProvider");
  return ctx;
}
