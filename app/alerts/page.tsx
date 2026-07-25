"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/components/auth";
import { usePrefs } from "@/components/prefs";
import { AlertPrefs, AlertRules, defaultPrefs, loadPrefs, savePrefs } from "@/lib/userPrefs";
import { HARBORS } from "@/lib/harbors";
import { BOATS, SKILLS, Skill } from "@/lib/boats";
import { COMPASS_16, Compass16 } from "@/lib/units";

export default function AlertsPage() {
  const { user, loading } = useAuth();
  const { customBoats } = usePrefs();
  const router = useRouter();
  const [prefs, setPrefs] = useState<AlertPrefs | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/account");
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    loadPrefs(user.uid).then((p) => setPrefs(p ?? defaultPrefs(user.email ?? "", user.displayName)));
  }, [user]);

  const patch = useCallback((p: Partial<AlertPrefs>) => setPrefs((cur) => (cur ? { ...cur, ...p } : cur)), []);
  const patchRule = useCallback(
    (r: Partial<AlertRules>) => setPrefs((cur) => (cur ? { ...cur, rules: { ...cur.rules, ...r } } : cur)),
    [],
  );

  async function save() {
    if (!user || !prefs) return;
    setSaving(true);
    setSaved(false);
    try {
      await savePrefs(user.uid, prefs);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  if (loading || !user || !prefs) {
    return <div className="grid min-h-[40vh] place-items-center text-slate-400">Loading your alerts…</div>;
  }

  const toggleHarbor = (id: string) =>
    patch({
      watchedHarbors: prefs.watchedHarbors.includes(id)
        ? prefs.watchedHarbors.filter((h) => h !== id)
        : [...prefs.watchedHarbors, id],
    });

  const dirs = prefs.rules.windDirFrom ?? [];
  const toggleDir = (d: Compass16) =>
    patchRule({ windDirFrom: dirs.includes(d) ? dirs.filter((x) => x !== d) : [...dirs, d] });

  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Your alerts</h1>
          <p className="text-sm text-slate-400">Signed in as {prefs.email}</p>
        </div>
        <Link href="/" className="text-sm text-slate-400 hover:text-slate-200">← Board</Link>
      </div>

      {/* Watched harbors */}
      <Section title="Harbors to watch" hint="You'll get alerts for these when your rules below are met.">
        <div className="flex flex-wrap gap-2">
          {HARBORS.map((h) => {
            const on = prefs.watchedHarbors.includes(h.id);
            return (
              <button
                key={h.id}
                onClick={() => toggleHarbor(h.id)}
                className={`rounded-full border px-3 py-1.5 text-sm transition ${
                  on ? "border-sky-400 bg-sky-500/20 text-sky-100" : "border-white/10 bg-slate-900 text-slate-400 hover:text-slate-200"
                }`}
              >
                {h.name}
              </button>
            );
          })}
        </div>
      </Section>

      {/* Boat + skill */}
      <Section title="Your boat" hint="Used for the 'turns green' rule and to rate conditions.">
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={prefs.boatId}
            onChange={(e) => patch({ boatId: e.target.value })}
            className="rounded-md border border-white/10 bg-slate-900 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-sky-400"
          >
            {BOATS.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            {customBoats.length > 0 && (
              <optgroup label="Your boats">
                {customBoats.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </optgroup>
            )}
          </select>
          <div className="flex overflow-hidden rounded-md border border-white/10">
            {SKILLS.map((s) => (
              <button
                key={s.id}
                onClick={() => patch({ skill: s.id as Skill })}
                className={`px-3 py-1.5 text-xs ${prefs.skill === s.id ? "bg-sky-500 text-white" : "bg-slate-900 text-slate-400 hover:text-slate-200"}`}
              >
                {s.name}
              </button>
            ))}
          </div>
        </div>
      </Section>

      {/* Alert rules */}
      <Section title="Alert me when…" hint="An alert fires only if every rule you set is satisfied.">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox" checked={prefs.rules.notifyWhenGreen}
            onChange={(e) => patchRule({ notifyWhenGreen: e.target.checked })}
            className="h-4 w-4 accent-sky-500"
          />
          A watched harbor turns <b className="text-emerald-300">green</b> for my boat
        </label>

        <div className="mt-4">
          <div className="text-sm font-medium text-slate-300">Wind coming from</div>
          <p className="mb-2 text-xs text-slate-500">Only alert when the wind is from one of these directions. None selected = any direction.</p>
          <div className="grid grid-cols-8 gap-1.5">
            {COMPASS_16.map((d) => {
              const on = dirs.includes(d);
              return (
                <button
                  key={d}
                  onClick={() => toggleDir(d)}
                  className={`rounded border px-1 py-1.5 text-xs transition ${
                    on ? "border-sky-400 bg-sky-500/20 text-sky-100" : "border-white/10 bg-slate-900 text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <NumField label="Max wind" unit="kt" value={prefs.rules.maxWindKt} onChange={(v) => patchRule({ maxWindKt: v })} />
          <NumField label="Max gusts" unit="kt" value={prefs.rules.maxGustKt} onChange={(v) => patchRule({ maxGustKt: v })} />
          <NumField label="Max waves" unit="ft" value={prefs.rules.maxWaveFt} onChange={(v) => patchRule({ maxWaveFt: v })} />
        </div>
      </Section>

      {/* Channels */}
      <Section title="Notify me by" hint="Delivery is coming soon — your choice is saved now.">
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox" checked={prefs.channels.email}
              onChange={(e) => patch({ channels: { ...prefs.channels, email: e.target.checked } })}
              className="h-4 w-4 accent-sky-500"
            />
            Email
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox" checked={prefs.channels.push}
              onChange={(e) => patch({ channels: { ...prefs.channels, push: e.target.checked } })}
              className="h-4 w-4 accent-sky-500"
            />
            Browser push
          </label>
        </div>
      </Section>

      <div className="mt-6 flex items-center gap-3">
        <button
          onClick={save} disabled={saving}
          className="rounded-lg bg-sky-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-sky-400 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save alerts"}
        </button>
        {saved && <span className="text-sm text-emerald-300">Saved ✓</span>}
      </div>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">{title}</h2>
      {hint && <p className="mb-3 mt-0.5 text-xs text-slate-500">{hint}</p>}
      {children}
    </section>
  );
}

function NumField({
  label, unit, value, onChange,
}: {
  label: string; unit: string; value: number | null; onChange: (v: number | null) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs text-slate-400">{label}</span>
      <div className="mt-1 flex items-center gap-1.5">
        <input
          type="number" min={0} inputMode="decimal" placeholder="any"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          className="w-full rounded-md border border-white/10 bg-slate-900 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-sky-400"
        />
        <span className="text-xs text-slate-500">{unit}</span>
      </div>
    </label>
  );
}
