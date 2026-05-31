"use client";

import { useState } from "react";
import { api, type PublicUser } from "@/lib/api";

export function AuthScreen({ onAuth }: { onAuth: (u: PublicUser) => void }) {
  const [mode, setMode] = useState<"login" | "register">("register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [market, setMarket] = useState("cz");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    setBusy(true);
    setErr("");
    try {
      const user =
        mode === "login"
          ? await api.login(email, password)
          : await api.register(email, password, market);
      onAuth(user);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-grain">
      <div className="mx-auto grid min-h-screen max-w-6xl grid-cols-1 items-center gap-12 px-6 lg:grid-cols-2">
        {/* Hero */}
        <div className="py-16">
          <div className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-ink-muted">
            <span className="h-2 w-2 rounded-full bg-save" /> TrueRate
          </div>
          <h1 className="font-display text-5xl leading-[1.05] text-ink lg:text-6xl">
            The rate that&apos;s{" "}
            <span className="italic text-save">actually&nbsp;yours.</span>
          </h1>
          <p className="mt-6 max-w-md text-lg leading-relaxed text-ink-muted">
            Anonymous search hides the prices your memberships already unlock. TrueRate
            keeps every membership in one place and reveals the real rate — on the web
            and inside your AI assistant.
          </p>
          <dl className="mt-10 grid max-w-md grid-cols-3 gap-6">
            {[
              ["1 place", "for every membership"],
              ["2 surfaces", "browser + AI"],
              ["0 guesswork", "see the delta"],
            ].map(([a, b]) => (
              <div key={a}>
                <dt className="font-display text-2xl text-ink">{a}</dt>
                <dd className="mt-1 text-sm text-ink-muted">{b}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/* Auth card */}
        <div className="py-16">
          <div className="mx-auto max-w-md rounded-xl2 border border-line bg-card p-8 shadow-[0_24px_60px_-30px_rgba(12,27,46,.35)]">
            <div className="mb-6 flex gap-1 rounded-xl bg-paper p-1">
              {(["register", "login"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`flex-1 rounded-lg py-2 text-sm font-medium transition ${
                    mode === m ? "bg-card text-ink shadow-sm" : "text-ink-muted"
                  }`}
                >
                  {m === "register" ? "Create account" : "Sign in"}
                </button>
              ))}
            </div>

            <label className="label">Email</label>
            <input
              className="field mb-4"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
            <label className="label">Password</label>
            <input
              className="field"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />

            {mode === "register" && (
              <div className="mt-4">
                <label className="label">Market</label>
                <select
                  className="field"
                  value={market}
                  onChange={(e) => setMarket(e.target.value)}
                >
                  <option value="cz">Czechia (EUR)</option>
                  <option value="us">United States (USD)</option>
                </select>
              </div>
            )}

            {err && <p className="mt-4 text-sm text-red-600">{err}</p>}

            <button
              className="btn-primary mt-6 w-full"
              onClick={submit}
              disabled={busy || !email || !password}
              data-testid="auth-submit"
            >
              {busy ? "…" : mode === "register" ? "Create account" : "Sign in"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
