"use client";

import { useState } from "react";
import { api, clearToken, type PublicUser } from "@/lib/api";

const MARKETS: { value: string; label: string }[] = [
  { value: "cz", label: "Czech Republic" },
  { value: "de", label: "Germany" },
  { value: "pl", label: "Poland" },
  { value: "at", label: "Austria" },
  { value: "sk", label: "Slovakia" },
  { value: "hu", label: "Hungary" },
  { value: "us", label: "United States" },
];

const CURRENCIES: { value: string; label: string }[] = [
  { value: "EUR", label: "Euro (EUR)" },
  { value: "USD", label: "US Dollar (USD)" },
  { value: "CZK", label: "Czech Koruna (CZK)" },
  { value: "PLN", label: "Polish Złoty (PLN)" },
  { value: "HUF", label: "Hungarian Forint (HUF)" },
];

export function AccountSettings({
  user: initial,
  onSignOut,
  onUserUpdate,
}: {
  user: PublicUser;
  onSignOut: () => void;
  onUserUpdate: (u: PublicUser) => void;
}) {
  const [market, setMarket] = useState(initial.market);
  const [currency, setCurrency] = useState(initial.currency);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);

  const dirty = market !== initial.market || currency !== initial.currency;

  async function save() {
    setBusy(true);
    setErr("");
    setSaved(false);
    try {
      const updated = await api.updateSettings({ market, currency });
      onUserUpdate(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section data-testid="account-settings">
      <div className="mb-6">
        <h1 className="font-display text-3xl text-ink">Account &amp; Settings</h1>
        <p className="mt-1 text-ink-muted">Your profile and app preferences.</p>
      </div>

      {/* Profile */}
      <div className="mb-5 rounded-xl2 border border-line bg-card p-5">
        <h2 className="mb-4 font-display text-xl text-ink">Profile</h2>
        <div>
          <p className="label">Email</p>
          <p className="text-ink" data-testid="profile-email">{initial.email}</p>
          <p className="mt-0.5 text-xs text-ink-muted">
            Password, MFA, and other security settings are managed by your identity provider.
          </p>
        </div>
      </div>

      {/* Preferences */}
      <div className="mb-5 rounded-xl2 border border-line bg-card p-5">
        <h2 className="mb-4 font-display text-xl text-ink">Preferences</h2>

        <div className="mb-4">
          <label className="label" htmlFor="settings-market-select">Market</label>
          <select
            id="settings-market-select"
            className="field"
            value={market}
            onChange={(e) => setMarket(e.target.value)}
            data-testid="settings-market"
          >
            {MARKETS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>

        <div className="mb-5">
          <label className="label" htmlFor="settings-currency-select">Currency</label>
          <select
            id="settings-currency-select"
            className="field"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            data-testid="settings-currency"
          >
            {CURRENCIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-ink-muted">
            Used to display estimated perk values. No prices are computed by TrueRate.
          </p>
        </div>

        {err && (
          <p className="mb-4 text-sm text-red-600" data-testid="settings-error">{err}</p>
        )}
        {saved && (
          <p className="mb-4 text-sm text-save" data-testid="settings-saved">Preferences saved.</p>
        )}

        <button
          className="btn-primary"
          onClick={save}
          disabled={busy || !dirty}
          data-testid="settings-save"
        >
          {busy ? "Saving…" : "Save preferences"}
        </button>
      </div>

      {/* Account actions */}
      <div className="rounded-xl2 border border-line bg-card p-5">
        <h2 className="mb-4 font-display text-xl text-ink">Account actions</h2>
        <button
          className="btn text-sm font-medium text-red-600 hover:text-red-700 underline-offset-4 hover:underline"
          onClick={() => { clearToken(); onSignOut(); }}
          data-testid="account-sign-out"
        >
          Sign out
        </button>
      </div>
    </section>
  );
}
