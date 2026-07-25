"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth, authErrorMessage } from "@/components/auth";

export default function AccountPage() {
  const { user, loading, signInGoogle, signInEmail, signUpEmail } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Once signed in, this page's job is done — send them to their alerts.
  useEffect(() => {
    if (!loading && user) router.replace("/alerts");
  }, [loading, user, router]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading || user) {
    return <div className="grid min-h-[40vh] place-items-center text-slate-400">Loading…</div>;
  }

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="text-2xl font-bold tracking-tight">{mode === "signin" ? "Sign in" : "Create your account"}</h1>
      <p className="mt-1 text-sm text-slate-400">
        Save harbors to watch and set alert thresholds for when it&apos;s good to sail.
      </p>

      <button
        onClick={() => run(signInGoogle)}
        disabled={busy}
        className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/[0.06] px-4 py-2.5 text-sm font-medium text-slate-100 hover:bg-white/10 disabled:opacity-50"
      >
        <span className="text-base">G</span> Continue with Google
      </button>

      <div className="my-5 flex items-center gap-3 text-xs text-slate-500">
        <span className="h-px flex-1 bg-white/10" /> or {mode === "signin" ? "sign in" : "sign up"} with email
        <span className="h-px flex-1 bg-white/10" />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(() => (mode === "signin" ? signInEmail(email, password) : signUpEmail(email, password, name || undefined)));
        }}
        className="space-y-3"
      >
        {mode === "signup" && (
          <input
            type="text" placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-400"
          />
        )}
        <input
          type="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-400"
        />
        <input
          type="password" required placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-400"
        />
        {error && <p className="text-sm text-rose-300">{error}</p>}
        <button
          type="submit" disabled={busy}
          className="w-full rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-400 disabled:opacity-50"
        >
          {busy ? "…" : mode === "signin" ? "Sign in" : "Create account"}
        </button>
      </form>

      <p className="mt-4 text-center text-sm text-slate-400">
        {mode === "signin" ? "New here? " : "Already have an account? "}
        <button
          onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(null); }}
          className="text-sky-400 hover:underline"
        >
          {mode === "signin" ? "Create an account" : "Sign in"}
        </button>
      </p>
      <p className="mt-6 text-center text-xs text-slate-500">
        <Link href="/" className="hover:text-slate-300">← Back to the board</Link>
      </p>
    </div>
  );
}
