"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/components/auth";
import { usePrefs } from "@/components/prefs";
import { saveCustomBoats } from "@/lib/userPrefs";
import {
  BoatCategory, BoatSpec, CATEGORY_LABEL, computeCSF, deriveBoatProfile, estimateAVS,
} from "@/lib/boatSpecs";
import { CatalogBoat, searchCatalog } from "@/lib/boatCatalog";

interface FormState {
  id: string | null;
  name: string;
  category: BoatCategory;
  loaFt: string; beamFt: string; displacementLb: string; ballastLb: string; draftFt: string; avsOverride: string;
}

const blankForm = (): FormState => ({
  id: null, name: "", category: "C",
  loaFt: "", beamFt: "", displacementLb: "", ballastLb: "", draftFt: "", avsOverride: "",
});

function specToForm(s: BoatSpec): FormState {
  const str = (n: number | null | undefined) => (n == null ? "" : String(n));
  return {
    id: s.id, name: s.name, category: s.category,
    loaFt: str(s.loaFt), beamFt: str(s.beamFt), displacementLb: str(s.displacementLb),
    ballastLb: str(s.ballastLb), draftFt: str(s.draftFt), avsOverride: str(s.avsOverride),
  };
}

function formToSpec(f: FormState): BoatSpec {
  const num = (s: string) => (s.trim() === "" ? null : Number(s));
  return {
    id: f.id ?? `custom:${crypto.randomUUID()}`,
    name: f.name.trim(),
    category: f.category,
    loaFt: num(f.loaFt), beamFt: num(f.beamFt), displacementLb: num(f.displacementLb),
    ballastLb: num(f.ballastLb), draftFt: num(f.draftFt), avsOverride: num(f.avsOverride),
  };
}

export default function BoatsPage() {
  const { user, loading } = useAuth();
  const { customBoats, reloadBoats } = usePrefs();
  const router = useRouter();
  const [editing, setEditing] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/account");
  }, [loading, user, router]);

  if (loading || !user) {
    return <div className="grid min-h-[40vh] place-items-center text-slate-400">Loading…</div>;
  }
  const uid = user.uid;

  async function persist(next: BoatSpec[]) {
    setBusy(true);
    try {
      await saveCustomBoats(uid, next);
      await reloadBoats();
    } finally {
      setBusy(false);
    }
  }
  async function save(spec: BoatSpec) {
    const next = customBoats.some((b) => b.id === spec.id)
      ? customBoats.map((b) => (b.id === spec.id ? spec : b))
      : [...customBoats, spec];
    await persist(next);
    setEditing(null);
  }
  async function remove(id: string) {
    await persist(customBoats.filter((b) => b.id !== id));
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My boats</h1>
          <p className="text-sm text-slate-400">Add your boat and its scores show up across the app.</p>
        </div>
        <Link href="/" className="text-sm text-slate-400 hover:text-slate-200">← Board</Link>
      </div>

      {/* Existing boats */}
      <div className="mt-5 space-y-3">
        {customBoats.length === 0 && !editing && (
          <p className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-400">
            No custom boats yet. Add one below — start typing a model name for suggestions.
          </p>
        )}
        {customBoats.map((b) => {
          const p = deriveBoatProfile(b);
          const csf = computeCSF(b);
          const avs = estimateAVS(b);
          return (
            <div key={b.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold text-slate-100">{b.name}</div>
                  <div className="mt-0.5 text-xs text-slate-400">
                    Cat {b.category} · CSF {csf ? csf.toFixed(2) : "—"} · AVS {avs ? `${Math.round(avs)}°` : "—"}
                  </div>
                  <div className="mt-1 text-sm text-slate-300">
                    Comfortable to <b>{p.windCalmKt} kt</b>, max <b>{p.windMaxKt} kt</b>; waves to <b>{p.waveMaxFt} ft</b>
                  </div>
                </div>
                <div className="flex shrink-0 gap-2 text-sm">
                  <button onClick={() => setEditing(specToForm(b))} className="text-sky-400 hover:underline">Edit</button>
                  <button onClick={() => remove(b.id)} disabled={busy} className="text-rose-400 hover:underline disabled:opacity-50">Delete</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {editing ? (
        <BoatForm initial={editing} busy={busy} onCancel={() => setEditing(null)} onSave={(f) => save(formToSpec(f))} />
      ) : (
        <button
          onClick={() => setEditing(blankForm())}
          className="mt-4 rounded-lg bg-sky-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-sky-400"
        >
          + Add a boat
        </button>
      )}
    </div>
  );
}

function BoatForm({
  initial, busy, onSave, onCancel,
}: {
  initial: FormState; busy: boolean; onSave: (f: FormState) => void; onCancel: () => void;
}) {
  const [form, setForm] = useState<FormState>(initial);
  const [showSuggest, setShowSuggest] = useState(false);
  const set = (p: Partial<FormState>) => setForm((f) => ({ ...f, ...p }));

  const suggestions = useMemo(() => (showSuggest ? searchCatalog(form.name) : []), [showSuggest, form.name]);

  function pick(b: CatalogBoat) {
    set({
      name: b.name, category: b.category,
      loaFt: String(b.loaFt), beamFt: String(b.beamFt), displacementLb: String(b.displacementLb),
      ballastLb: String(b.ballastLb), draftFt: String(b.draftFt),
    });
    setShowSuggest(false);
  }

  const spec = formToSpec(form);
  const csf = computeCSF(spec);
  const avs = estimateAVS(spec);
  const p = deriveBoatProfile(spec);

  return (
    <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
        {form.id ? "Edit boat" : "Add a boat"}
      </h2>

      {/* Name with typeahead */}
      <div className="relative mt-3">
        <label className="text-xs text-slate-400">Boat name</label>
        <input
          value={form.name}
          onChange={(e) => { set({ name: e.target.value }); setShowSuggest(true); }}
          onFocus={() => setShowSuggest(true)}
          placeholder="Start typing, e.g. Catalina 30"
          className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-400"
        />
        {suggestions.length > 0 && (
          <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-white/10 bg-slate-900 shadow-lg">
            {suggestions.map((b) => (
              <li key={b.name}>
                <button
                  type="button" onClick={() => pick(b)}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/10"
                >
                  <span>{b.name}</span>
                  <span className="text-xs text-slate-500">Cat {b.category} · {b.loaFt}′</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Category */}
      <div className="mt-3">
        <label className="text-xs text-slate-400">ISO 12217 design category</label>
        <select
          value={form.category}
          onChange={(e) => set({ category: e.target.value as BoatCategory })}
          className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-400"
        >
          {(["A", "B", "C", "D"] as BoatCategory[]).map((c) => (
            <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
          ))}
        </select>
        <p className="mt-1 text-xs text-slate-500">Sets the base wind/wave limits. Dimensions below refine the score.</p>
      </div>

      {/* Optional dimensions */}
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="LOA (ft)" value={form.loaFt} onChange={(v) => set({ loaFt: v })} />
        <Field label="Beam (ft)" value={form.beamFt} onChange={(v) => set({ beamFt: v })} />
        <Field label="Displacement (lb)" value={form.displacementLb} onChange={(v) => set({ displacementLb: v })} />
        <Field label="Ballast (lb)" value={form.ballastLb} onChange={(v) => set({ ballastLb: v })} />
        <Field label="Draft (ft)" value={form.draftFt} onChange={(v) => set({ draftFt: v })} />
        <Field label="AVS (°, optional)" value={form.avsOverride} onChange={(v) => set({ avsOverride: v })} />
      </div>

      {/* Live derived preview */}
      <div className="mt-4 rounded-lg border border-sky-500/30 bg-sky-500/10 p-3 text-sm text-sky-100">
        <div className="text-xs uppercase tracking-wide text-sky-300/80">Derived rating</div>
        <div className="mt-1">
          Category {form.category} · CSF {csf ? csf.toFixed(2) : "—"} · AVS {avs ? `${Math.round(avs)}°` : "—"} (est.)
        </div>
        <div className="mt-0.5 text-sky-200/90">
          Comfortable to {p.windCalmKt} kt, max {p.windMaxKt} kt · waves to {p.waveMaxFt} ft
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={() => onSave(form)}
          disabled={busy || form.name.trim() === ""}
          className="rounded-lg bg-sky-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-sky-400 disabled:opacity-50"
        >
          {busy ? "Saving…" : form.id ? "Save changes" : "Add boat"}
        </button>
        <button onClick={onCancel} className="text-sm text-slate-400 hover:text-slate-200">Cancel</button>
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-xs text-slate-400">{label}</span>
      <input
        type="number" min={0} inputMode="decimal" value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-white/10 bg-slate-900 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-sky-400"
      />
    </label>
  );
}
