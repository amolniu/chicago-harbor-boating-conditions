"use client";

import Link from "next/link";
import { usePrefs } from "./prefs";
import { useAuth } from "./auth";
import { useTheme } from "./theme";
import { BOATS, SKILLS, Skill } from "@/lib/boats";
import { APP_NAME, TAGLINE } from "@/lib/brand";

export function Header() {
  const { boatId, skill, setBoatId, setSkill, customBoats } = usePrefs();

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-header backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-6">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="text-xl">⛵</span>
          <span>
            {APP_NAME}
            <span className="ml-2 hidden text-xs font-normal text-muted sm:inline">{TAGLINE}</span>
          </span>
        </Link>

        <div className="flex items-center gap-2 text-sm sm:ml-auto">
          <label className="flex min-w-0 flex-1 items-center gap-1.5 sm:flex-none">
            <span className="hidden text-muted sm:inline">Boat</span>
            <select
              value={boatId}
              onChange={(e) => setBoatId(e.target.value)}
              className="min-w-0 flex-1 rounded-md border border-line bg-raised px-2 py-1.5 text-strong outline-none focus:border-brand sm:flex-none"
            >
              {BOATS.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
              {customBoats.length > 0 && (
                <optgroup label="Your boats">
                  {customBoats.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>

          <div className="flex shrink-0 overflow-hidden rounded-md border border-line">
            {SKILLS.map((s) => (
              <button
                key={s.id}
                onClick={() => setSkill(s.id as Skill)}
                className={`whitespace-nowrap px-2.5 py-2 text-xs transition sm:py-1.5 ${
                  skill === s.id ? "bg-brand text-brand-on" : "bg-raised text-muted hover:text-fg"
                }`}
                title={`${s.name} sailor`}
              >
                {s.name}
              </button>
            ))}
          </div>

          <ThemeToggle />
        </div>

        <AuthControl />
      </div>
    </header>
  );
}

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const dark = theme === "dark";
  return (
    <button
      onClick={toggleTheme}
      title={dark ? "Switch to light theme" : "Switch to dark theme"}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      className="shrink-0 rounded-md border border-line bg-raised px-2.5 py-2 text-muted transition hover:text-fg sm:py-1.5"
    >
      {/* Shows where you're going, not where you are. */}
      <span className="text-sm leading-none">{dark ? "☀" : "☾"}</span>
    </button>
  );
}

function AuthControl() {
  const { user, loading, signOut } = useAuth();
  if (loading) return null;
  if (!user) {
    return (
      <Link
        href="/account"
        className="whitespace-nowrap rounded-md border border-line bg-raised px-3 py-1.5 text-sm text-fg hover:text-strong sm:ml-2"
      >
        Sign in
      </Link>
    );
  }
  return (
    <div className="flex items-center gap-2 text-sm sm:ml-2">
      <Link
        href="/boats"
        title="My boats"
        className="whitespace-nowrap rounded-md border border-line bg-raised px-3 py-1.5 text-fg hover:text-strong"
      >
        ⛵ Boats
      </Link>
      <Link
        href="/alerts"
        title="Your alert"
        className="whitespace-nowrap rounded-md border border-brand/40 bg-brand/10 px-3 py-1.5 text-brand-fg hover:bg-brand/20"
      >
        🔔 Alert
      </Link>
      <button
        onClick={() => void signOut()}
        title={user.email ?? "Sign out"}
        className="whitespace-nowrap text-muted hover:text-fg"
      >
        Sign out
      </button>
    </div>
  );
}
