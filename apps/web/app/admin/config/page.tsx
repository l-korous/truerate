"use client";

import { useEffect, useState } from "react";
import { adminConfigApi, type AppConfig, type AppConfigInput } from "@/lib/api";

const EMPTY_INPUT: AppConfigInput = { key: "", label: "", value: "", description: "" };

export default function AppConfigAdminPage() {
  const [configs, setConfigs] = useState<AppConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<AppConfigInput>(EMPTY_INPUT);
  const [editForm, setEditForm] = useState<AppConfigInput>(EMPTY_INPUT);
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    setError(null);
    adminConfigApi
      .list()
      .then((r) => setConfigs(r.config))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const result = await adminConfigApi.create(form);
      setConfigs((prev) => [...prev, result.config].sort((a, b) => a.key.localeCompare(b.key)));
      setCreating(false);
      setForm(EMPTY_INPUT);
    } catch (err: unknown) {
      alert(`Create failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleStartEdit = (cfg: AppConfig) => {
    setEditing(cfg.key);
    setEditForm({ key: cfg.key, label: cfg.label, value: cfg.value, description: cfg.description });
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    try {
      const result = await adminConfigApi.update(editing, editForm);
      setConfigs((prev) => prev.map((c) => (c.key === editing ? result.config : c)));
      setEditing(null);
    } catch (err: unknown) {
      alert(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (key: string) => {
    if (!confirm(`Delete config '${key}'? This cannot be undone.`)) return;
    try {
      await adminConfigApi.delete(key);
      setConfigs((prev) => prev.filter((c) => c.key !== key));
    } catch (e: unknown) {
      alert(`Delete failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="min-h-screen bg-grain px-6 py-12">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="h-2 w-2 rounded-full bg-save" />
            <h1 className="font-display text-3xl text-ink">App config</h1>
          </div>
          <button
            onClick={() => setCreating(true)}
            className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper hover:bg-ink/90"
          >
            New config
          </button>
        </div>

        <p className="mb-6 text-sm text-ink-muted">
          Non-secret operational settings consumed by services and channels. Secrets belong in Azure Key Vault, not here.
        </p>

        {creating && (
          <form
            onSubmit={handleCreate}
            className="mb-6 rounded-xl border border-line bg-card px-6 py-5 space-y-4"
            data-testid="config-create-form"
          >
            <h2 className="font-medium text-ink">New config entry</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-muted">Key</label>
                <input
                  required
                  pattern="[a-z0-9._-]+"
                  value={form.key}
                  onChange={(e) => setForm((f) => ({ ...f, key: e.target.value }))}
                  placeholder="e.g. catalog.staleness.warn_months"
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
              <label className="mb-1 block text-xs font-medium text-ink-muted">Value</label>
              <input
                required
                value={form.value}
                onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
                placeholder="Config value (string)"
                className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-muted">Description (optional)</label>
              <input
                value={form.description ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="What does this config control?"
                className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink"
              />
            </div>
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper hover:bg-ink/90 disabled:opacity-50"
              >
                {saving ? "Creating…" : "Create config"}
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

        {!loading && configs.length === 0 && (
          <p className="text-sm text-ink-muted">No config entries. Create the first one above.</p>
        )}

        {!loading && configs.length > 0 && (
          <div className="space-y-2" data-testid="config-list">
            {configs.map((cfg) =>
              editing === cfg.key ? (
                <form
                  key={cfg.key}
                  onSubmit={handleSaveEdit}
                  className="rounded-xl border border-blue-200 bg-blue-50 px-5 py-4 space-y-3"
                  data-testid={`config-edit-form-${cfg.key}`}
                >
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-ink-muted">Label</label>
                      <input
                        required
                        value={editForm.label}
                        onChange={(e) => setEditForm((f) => ({ ...f, label: e.target.value }))}
                        className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-ink-muted">Value</label>
                      <input
                        required
                        value={editForm.value}
                        onChange={(e) => setEditForm((f) => ({ ...f, value: e.target.value }))}
                        className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-ink-muted">Description</label>
                    <input
                      value={editForm.description ?? ""}
                      onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                      className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink"
                    />
                  </div>
                  <div className="flex gap-3">
                    <button
                      type="submit"
                      disabled={saving}
                      className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper hover:bg-ink/90 disabled:opacity-50"
                    >
                      {saving ? "Saving…" : "Save"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing(null)}
                      className="rounded-lg border border-line px-4 py-2 text-sm text-ink hover:bg-paper"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <div
                  key={cfg.key}
                  className="flex items-center justify-between rounded-xl border border-line bg-card px-5 py-4"
                  data-testid={`config-entry-${cfg.key}`}
                >
                  <div>
                    <p className="font-medium text-ink">{cfg.label}</p>
                    <p className="text-xs text-ink-muted">
                      {cfg.key}
                      {cfg.description && ` — ${cfg.description}`}
                    </p>
                    <p className="mt-1 font-mono text-sm text-ink">{cfg.value}</p>
                    <p className="text-xs text-ink-muted">
                      last changed {cfg.updatedAt.slice(0, 10)} by {cfg.updatedBy}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => handleStartEdit(cfg)}
                      className="text-sm text-ink underline-offset-2 hover:underline"
                      data-testid={`config-edit-${cfg.key}`}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(cfg.key)}
                      className="text-sm text-red-600 hover:text-red-800"
                      data-testid={`config-delete-${cfg.key}`}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}
