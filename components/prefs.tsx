"use client";

// Shared boat + skill selection. Boat/skill choice persists to localStorage; a
// signed-in user's custom boats load from Firestore. One place resolves the
// selected boatId (built-in OR custom) to a BoatProfile, so the whole app scores
// against it without knowing whether it's custom.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { BOATS, BoatProfile, DEFAULT_BOAT_ID, DEFAULT_SKILL, Skill, getBoat } from "@/lib/boats";
import { BoatSpec, deriveBoatProfile } from "@/lib/boatSpecs";
import { loadCustomBoats, loadFavorites, saveFavorites } from "@/lib/userPrefs";
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
  /** Favorite harbor ids (localStorage; synced to Firestore when signed in). */
  favorites: string[];
  isFavorite: (id: string) => boolean;
  toggleFavorite: (id: string) => void;
}

const PrefsContext = createContext<Prefs | null>(null);

export function PrefsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [boatId, setBoatId] = useState(DEFAULT_BOAT_ID);
  const [skill, setSkill] = useState<Skill>(DEFAULT_SKILL);
  const [customBoats, setCustomBoats] = useState<BoatSpec[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);

  useEffect(() => {
    // Hydrate from localStorage after mount (avoids an SSR hydration mismatch).
    const b = localStorage.getItem("boatId");
    const s = localStorage.getItem("skill") as Skill | null;
    /* eslint-disable react-hooks/set-state-in-effect */
    if (b) setBoatId(b);
    if (s === "beginner" || s === "intermediate" || s === "advanced") setSkill(s);
    const f = localStorage.getItem("favorites");
    if (f) {
      try {
        const arr = JSON.parse(f);
        if (Array.isArray(arr)) setFavorites(arr.filter((x): x is string => typeof x === "string"));
      } catch {}
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    localStorage.setItem("boatId", boatId);
  }, [boatId]);
  useEffect(() => {
    localStorage.setItem("skill", skill);
  }, [skill]);
  useEffect(() => {
    localStorage.setItem("favorites", JSON.stringify(favorites));
  }, [favorites]);

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

  // On sign-in, merge locally-starred favorites with the account's and persist the
  // union, so a signed-out user's stars carry into their account.
  useEffect(() => {
    if (!user) return;
    let live = true;
    loadFavorites(user.uid).then((remote) => {
      if (!live) return;
      const union = Array.from(new Set([...favorites, ...remote]));
      setFavorites(union);
      if (union.length !== remote.length) saveFavorites(user.uid, union);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const isFavorite = useCallback((id: string) => favorites.includes(id), [favorites]);
  const toggleFavorite = useCallback(
    (id: string) => {
      const next = favorites.includes(id) ? favorites.filter((x) => x !== id) : [...favorites, id];
      setFavorites(next);
      if (user) saveFavorites(user.uid, next);
    },
    [favorites, user],
  );

  const boats = useMemo(() => [...BOATS, ...customBoats.map(deriveBoatProfile)], [customBoats]);
  const boat = useMemo(() => boats.find((b) => b.id === boatId) ?? getBoat(boatId), [boats, boatId]);

  return (
    <PrefsContext.Provider
      value={{ boatId, skill, setBoatId, setSkill, customBoats, boats, boat, reloadBoats, favorites, isFavorite, toggleFavorite }}
    >
      {children}
    </PrefsContext.Provider>
  );
}

export function usePrefs(): Prefs {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error("usePrefs must be used within PrefsProvider");
  return ctx;
}
