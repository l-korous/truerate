"use client";

import { useEffect, useState } from "react";
import { adminFlagsApi, type FeatureFlag, type FeatureFlagInput } from "@/lib/api";

const EMPTY_INPUT: FeatureFlagInput = { key: "", label: "", enabled: false, description: "", environment: "all" };

export default function FeatureFlagsAdminPage() {
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FeatureFlagInput>(EMPTY_INPUT);
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    setError(null);
    adminFlagsApi
      .list()
      .then((r) => setFlags(r.flags))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleToggle = async (flag: FeatureFlag) => {
    try {
      const updated = await adminFlagsApi.update(flag.key, { ...flag, enabled: !flag.enabled });
      setFlags((prev) => prev.map((f) => (f.key === flag.key ? updated.flag : f)));
    } catch (e: unknown) {
      alert(`Toggle failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleDelete = async (key: string) => {
    if (!confirm(`Delete flag '${key}'? This cannot be undone.`)) return;
    try {
      await adminFlagsApi.delete(key);
      setFlags((prev) => prev.filter((f) => f.key !== key));
    } catch (e: unknown) {
      alert(`Delete failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const result = await adminFlagsApi.create(form);
      setFlags((prev) => [...prev, result.flag].sort((a, b) => a.key.localeCompare(b.key)));
      setCreating(false);
      setForm(EMPTY_INPUT);
    } catch (err: unknown) {
      alert(`Create failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-grain px-6 py-12">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="h-2 w-2 rounded-full bg-save" />
            <h1 className="font-display text-3xl text-ink">Feature flags</h1>
          </div>
          <button
            onClick={() => setCreating(true)}
            className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper hover:bg-ink/90"
          >
            New flag
          </button>
        </div>

        {creating && (
          <form
            onSubmit={handleCreate}
            className="mb-6 rounded-xl border border-line bg-card px-6 py-5 space-y-4"
            data-testid="flag-create-form"
          >
            <h2 className="font-medium text-ink">New feature flag</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-muted">Key</label>
                <input
                  required
                  pattern="[a-z0-9._-]+"
                  value={form.key}
                  onChange={(e) => setForm((f) => ({ ...f, key: e.target.value }))}
                  placeholder="e.g. mcp.hints.enabled"
                  className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-muted">Label</label>
                <input
                  required
                  value={form.label}
                  onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                  placeholder="Human-readable name"
                  className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-muted">Description (optional)</label>
              <input
                value={form.description ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="What does this flag control?"
                className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-muted">Environment</label>
                <select
                  value={form.environment ?? "all"}
                  onChange={(e) => setForm((f) => ({ ...f, environment: e.target.value }))}
                  className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink"
                >
                  <option value="all">all</option>
                  <option value="production">production</option>
                  <option value="staging">staging</option>
                </select>
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={form.enabled}
                    onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
                    className="h-4 w-4"
                  />
                  Enabled on creation
                </label>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper hover:bg-ink/90 disabled:opacity-50"
              >
                {saving ? "Creating…" : "Create flag"}
              </button>
              <button
                type="button"
                onClick={() => { setCreating(false); setForm(EMPTY_INPUT); }}
                className="rounded-lg border border-line px-4 py-2 text-sm text-ink hover:bg-paper"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {error && (
          <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
        )}

        {loading && <p className="text-sm text-ink-muted">Loading…</p>}

        {!loading && flags.length === 0 && (
          <p className="text-sm text-ink-muted">No flags defined. Create the first one above.</p>
        )}

        {!loading && flags.length > 0 && (
          <div className="space-y-2" data-testid="flags-list">
            {flags.map((flag) => (
              <div
                key={flag.key}
                className="flex items-center justify-between rounded-xl border border-line bg-card px-5 py-4"
                data-testid={`flag-${flag.key}`}
              >
                <div className="flex items-start gap-4">
                  <button
                    onClick={() => handleToggle(flag)}
                    aria-label={flag.enabled ? "Disable flag" : "Enable flag"}
                    className={`mt-0.5 h-5 w-9 flex-shrink-0 rounded-full transition-colors ${
                      flag.enabled ? "bg-save" : "bg-line"
                    } relative`}
                    data-testid={`flag-toggle-${flag.key}`}
                  >
                    <span
                      className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                        flag.enabled ? "translate-x-4" : "translate-x-0.5"
                      }`}
                    />
                  </button>
                  <div>
                    <p className="font-medium text-ink">{flag.label}</p>
                    <p className="text-xs text-ink-muted">
                      {flag.key}
                      {flag.environment && flag.environment !== "all" && ` · ${flag.environment}`}
                      {flag.description && ` — ${flag.description}`}
                    </p>
                    <p className="text-xs text-ink-muted">
                      last changed {flag.updatedAt.slice(0, 10)} by {flag.updatedBy}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      flag.enabled ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {flag.enabled ? "enabled" : "disabled"}
                  </span>
                  <button
                    onClick={() => handleDelete(flag.key)}
                    className="text-sm text-red-600 hover:text-red-800"
                    data-testid={`flag-delete-${flag.key}`}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
