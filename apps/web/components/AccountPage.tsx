"use client";

import { useState } from "react";
import { api, clearToken, type PublicUser } from "@/lib/api";

const MARKETS: { value: string; label: string; currency: string }[] = [
  { value: "cz", label: "Czechia", currency: "EUR" },
  { value: "de", label: "Germany", currency: "EUR" },
  { value: "pl", label: "Poland", currency: "PLN" },
  { value: "at", label: "Austria", currency: "EUR" },
  { value: "sk", label: "Slovakia", currency: "EUR" },
  { value: "hu", label: "Hungary", currency: "HUF" },
  { value: "us", label: "United States", currency: "USD" },
];

const CURRENCY_LABELS: Record<string, string> = {
  EUR: "Euro (EUR)", PLN: "Polish Złoty (PLN)", HUF: "Hungarian Forint (HUF)", USD: "US Dollar (USD)",
};

interface Props {
  user: PublicUser;
  onSignOut: () => void;
  onUserUpdated: (u: PublicUser) => void;
}

export function AccountPage({ user, onSignOut, onUserUpdated }: Props) {
  const [market, setMarket] = useState(user.market);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const selectedMarket = MARKETS.find((m) => m.value === market);
  const previewCurrency = selectedMarket?.currency ?? user.currency;
  const dirty = market !== user.market;

  async function saveSettings() {
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const updated = await api.updateSettings({ market });
      onUserUpdated(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function signOut() {
    clearToken();
    onSignOut();
  }

  const memberSince = user.createdAt
    ? new Date(user.createdAt).toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" })
    : "—";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl text-ink">Account &amp; Settings</h1>
        <p className="mt-1 text-ink-muted">Manage your profile, preferences, and account actions.</p>
      </div>

      {/* Profile */}
      <section className="rounded-xl2 border border-line bg-card p-6">
        <h2 className="mb-4 font-display text-xl text-ink">Profile</h2>
        <dl className="space-y-3">
          <div className="flex items-center justify-between border-b border-line pb-3">
            <dt className="text-sm font-medium text-ink-muted">Email</dt>
            <dd className="text-sm text-ink" data-testid="profile-email">{user.email}</dd>
          </div>
          <div className="flex items-center justify-between border-b border-line pb-3">
            <dt className="text-sm font-medium text-ink-muted">Member since</dt>
            <dd className="text-sm text-ink" data-testid="profile-member-since">{memberSince}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-sm font-medium text-ink-muted">Display currency</dt>
            <dd className="text-sm text-ink" data-testid="profile-currency">
              {CURRENCY_LABELS[user.currency] ?? user.currency}
            </dd>
          </div>
        </dl>

        <div className="mt-4 rounded-lg bg-paper px-4 py-3 text-sm text-ink-muted">
          Password and account security settings are managed by your identity provider.
          Contact support if you need to change your email or delete your account.
        </div>
      </section>

      {/* Settings */}
      <section className="rounded-xl2 border border-line bg-card p-6">
        <h2 className="mb-1 font-display text-xl text-ink">Settings</h2>
        <p className="mb-4 text-sm text-ink-muted">
          App-level preferences. Perk value estimates use your region&apos;s currency — no prices involved.
        </p>

        <div className="space-y-4">
          <div>
            <label className="label">Region / Market</label>
            <select
              className="field"
              value={market}
              onChange={(e) => setMarket(e.target.value)}
              data-testid="settings-market"
            >
              {MARKETS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-ink-muted">
              Display currency will update to <strong>{previewCurrency}</strong> when saved.
            </p>
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <button
          className="btn-primary mt-5"
          onClick={saveSettings}
          disabled={saving || !dirty}
          data-testid="settings-save"
        >
          {saving ? "Saving…" : saved ? "Saved ✓" : "Save settings"}
        </button>
      </section>

      {/* Account actions */}
      <section className="rounded-xl2 border border-line bg-card p-6">
        <h2 className="mb-4 font-display text-xl text-ink">Account actions</h2>
        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-600 transition hover:bg-red-100"
            onClick={signOut}
            data-testid="account-sign-out"
          >
            Sign out
          </button>
        </div>
      </section>
    </div>
  );
}
