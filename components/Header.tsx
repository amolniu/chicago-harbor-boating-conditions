"use client";

import Link from "next/link";
import { usePrefs } from "./prefs";
import { useAuth } from "./auth";
import { BOATS, SKILLS, Skill } from "@/lib/boats";

export function Header() {
  const { boatId, skill, setBoatId, setSkill, customBoats } = usePrefs();

  return (
    <header className="sticky top-0 z-20 border-b border-white/10 bg-slate-950/70 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-6">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="text-xl">⛵</span>
          <span>
            Chicago Harbor Sailing
            <span className="ml-2 hidden text-xs font-normal text-slate-400 sm:inline">
              should I sail right now?
            </span>
          </span>
        </Link>

        <div className="flex items-center gap-2 text-sm sm:ml-auto">
          <label className="flex min-w-0 flex-1 items-center gap-1.5 sm:flex-none">
            <span className="hidden text-slate-400 sm:inline">Boat</span>
            <select
              value={boatId}
              onChange={(e) => setBoatId(e.target.value)}
              className="min-w-0 flex-1 rounded-md border border-white/10 bg-slate-900 px-2 py-1.5 text-slate-100 outline-none focus:border-sky-400 sm:flex-none"
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

          <div className="flex shrink-0 overflow-hidden rounded-md border border-white/10">
            {SKILLS.map((s) => (
              <button
                key={s.id}
                onClick={() => setSkill(s.id as Skill)}
                className={`whitespace-nowrap px-2.5 py-2 text-xs transition sm:py-1.5 ${
                  skill === s.id ? "bg-sky-500 text-white" : "bg-slate-900 text-slate-400 hover:text-slate-200"
                }`}
                title={`${s.name} sailor`}
              >
                {s.name}
              </button>
            ))}
          </div>
        </div>

        <AuthControl />
      </div>
    </header>
  );
}

function AuthControl() {
  const { user, loading, signOut } = useAuth();
  if (loading) return null;
  if (!user) {
    return (
      <Link
        href="/account"
        className="whitespace-nowrap rounded-md border border-white/10 bg-slate-900 px-3 py-1.5 text-sm text-slate-300 hover:text-white sm:ml-2"
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
        className="whitespace-nowrap rounded-md border border-white/10 bg-slate-900 px-3 py-1.5 text-slate-300 hover:text-white"
      >
        ⛵ Boats
      </Link>
      <Link
        href="/alerts"
        title="Your alert"
        className="whitespace-nowrap rounded-md border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-sky-200 hover:bg-sky-500/20"
      >
        🔔 Alert
      </Link>
      <button
        onClick={() => void signOut()}
        title={user.email ?? "Sign out"}
        className="whitespace-nowrap text-slate-400 hover:text-slate-200"
      >
        Sign out
      </button>
    </div>
  );
}
