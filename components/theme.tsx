"use client";

// Light/dark theme. Light is the default: we intentionally ignore the OS
// prefers-color-scheme so every first-time visitor lands on the light theme, and
// only a deliberate toggle switches to dark. The choice persists in localStorage
// and is applied to <html class="dark"> before first paint by the inline script in
// app/layout.tsx, so there's no flash of the wrong theme on reload.

import { createContext, useCallback, useContext, useEffect, useState } from "react";

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "theme";

/** Runs before hydration (stringified into the document head). Keep it tiny and
 *  dependency-free — it blocks paint. */
export const THEME_INIT_SCRIPT = `try{if(localStorage.getItem("${THEME_STORAGE_KEY}")==="dark")document.documentElement.classList.add("dark")}catch(e){}`;

interface ThemeCtx {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeCtx | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Server-render as light so the markup is stable; the effect below syncs to
  // whatever the pre-paint script already applied.
  const [theme, setThemeState] = useState<Theme>("light");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setThemeState(document.documentElement.classList.contains("dark") ? "dark" : "light");
  }, []);

  // Write the class and storage directly here rather than in an effect on `theme`:
  // an effect would briefly clear `.dark` on mount (state starts "light") and flash.
  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    document.documentElement.classList.toggle("dark", t === "dark");
    try {
      localStorage.setItem(THEME_STORAGE_KEY, t);
    } catch {}
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(document.documentElement.classList.contains("dark") ? "light" : "dark");
  }, [setTheme]);

  return <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeCtx {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
