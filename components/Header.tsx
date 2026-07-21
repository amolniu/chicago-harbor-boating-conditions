"use client";

import Link from "next/link";
import { usePrefs } from "./prefs";
import { BOATS, SKILLS, Skill } from "@/lib/boats";

export function Header() {
  const { boatId, skill, setBoatId, setSkill } = usePrefs();

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
      </div>
    </header>
  );
}
