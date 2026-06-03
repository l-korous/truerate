"use client";

import { useEffect, useState } from "react";
import {
  adminFlagApi,
  adminConfigApi,
  type FeatureFlag,
  type AppConfig,
  type FeatureFlagInput,
  type AppConfigInput,
} from "@/lib/api";

// ─── Feature flags panel ─────────────────────────────────────────────────────

function FlagRow({ flag, onToggle, onDelete }: {
  flag: FeatureFlag;
  onToggle: (key: string) => void;
  onDelete: (key: string) => void;
}) {
  return (
    <div
      className="flex items-center justify-between rounded-xl border border-line bg-card px-5 py-4"
      data-testid={`flag-row-${flag.key}`}
    >
      <div className="flex items-center gap-4 min-w-0">
        <button
          onClick={() => onToggle(flag.key)}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${
            flag.enabled ? "bg-save" : "bg-line"
          }`}
          aria-label={flag.enabled ? "Disable flag" : "Enable flag"}
          data-testid={`flag-toggle-${flag.key}`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-paper shadow transition-transform ${
              flag.enabled ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
        <div className="min-w-0">
          <p className="font-medium text-ink font-mono text-sm">{flag.key}</p>
          <p className="text-xs text-ink-muted truncate">{flag.description}</p>
          {flag.environment && (
            <span className="mt-0.5 inline-block rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
              {flag.environment}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0 ml-4">
        <span className={`text-xs font-medium ${flag.enabled ? "text-save" : "text-ink-muted"}`}>
          {flag.enabled ? "on" : "off"}
        </span>
        <button
          onClick={() => onDelete(flag.key)}
          className="text-xs text-red-500 hover:text-red-700"
          aria-label="Delete flag"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

function NewFlagForm({ onCreated }: { onCreated: (flag: FeatureFlag) => void }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [description, setDescription] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [environment, setEnvironment] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const input: FeatureFlagInput = { key, description, enabled, ...(environment ? { environment } : {}) };
      const { flag } = await adminFlagApi.create(input);
      onCreated(flag);
      setOpen(false);
      setKey("");
      setDescription("");
      setEnabled(false);
      setEnvironment("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create flag");
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper hover:bg-ink/90"
      >
        New flag
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-line bg-card px-5 py-4 space-y-3">
      <h3 className="font-medium text-ink text-sm">New feature flag</h3>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-ink-muted mb-1">Key <span className="text-red-500">*</span></label>
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="extension.genius_aware"
            className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink font-mono focus:outline-none focus:ring-1 focus:ring-ink"
            required
            pattern="[a-z0-9_.:\-]+"
            title="Lowercase letters, digits, dot, underscore, colon or dash only"
          />
        </div>
        <div>
          <label className="block text-xs text-ink-muted mb-1">Environment</label>
          <input
            value={environment}
            onChange={(e) => setEnvironment(e.target.value)}
            placeholder="production (optional)"
            className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-ink"
          />
        </div>
      </div>
      <div>
        <label className="block text-xs text-ink-muted mb-1">Description <span className="text-red-500">*</span></label>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What does this flag control?"
          className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-ink"
          required
        />
      </div>
      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="rounded border-line"
        />
        Enable immediately
      </label>
      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper hover:bg-ink/90 disabled:opacity-60"
        >
          {saving ? "Creating…" : "Create"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-ink-muted hover:text-ink">
          Cancel
        </button>
      </div>
    </form>
  );
}

// ─── Config entries panel ────────────────────────────────────────────────────

function ConfigRow({ entry, onEdit, onDelete }: {
  entry: AppConfig;
  onEdit: (entry: AppConfig) => void;
  onDelete: (key: string) => void;
}) {
  return (
    <div
      className="flex items-center justify-between rounded-xl border border-line bg-card px-5 py-4"
      data-testid={`config-row-${entry.key}`}
    >
      <div className="min-w-0">
        <p className="font-medium text-ink font-mono text-sm">{entry.key}</p>
        <p className="text-xs text-ink-muted">{entry.description}</p>
        {entry.environment && (
          <span className="mt-0.5 inline-block rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
            {entry.environment}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3 shrink-0 ml-4">
        <code className="rounded bg-grain px-2 py-0.5 text-xs text-ink max-w-[160px] truncate block">
          {entry.value}
        </code>
        <button
          onClick={() => onEdit(entry)}
          className="text-xs text-ink hover:underline"
        >
          Edit
        </button>
        <button
          onClick={() => onDelete(entry.key)}
          className="text-xs text-red-500 hover:text-red-700"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

function EditConfigModal({ entry, onSaved, onClose }: {
  entry: AppConfig;
  onSaved: (entry: AppConfig) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(entry.value);
  const [description, setDescription] = useState(entry.description);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const { entry: saved } = await adminConfigApi.update(entry.key, { value, description });
      onSaved(saved);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update config");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-2xl border border-line bg-card p-6 shadow-xl space-y-4"
      >
        <h3 className="font-medium text-ink">Edit config: <code className="text-sm font-mono">{entry.key}</code></h3>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div>
          <label className="block text-xs text-ink-muted mb-1">Value</label>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink font-mono focus:outline-none focus:ring-1 focus:ring-ink"
          />
        </div>
        <div>
          <label className="block text-xs text-ink-muted mb-1">Description</label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-ink"
          />
        </div>
        <div className="flex gap-2 pt-1">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper hover:bg-ink/90 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={onClose} className="text-sm text-ink-muted hover:text-ink">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

function NewConfigForm({ onCreated }: { onCreated: (entry: AppConfig) => void }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [description, setDescription] = useState("");
  const [environment, setEnvironment] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const input: AppConfigInput = { key, value, description, ...(environment ? { environment } : {}) };
      const { entry } = await adminConfigApi.create(input);
      onCreated(entry);
      setOpen(false);
      setKey("");
      setValue("");
      setDescription("");
      setEnvironment("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create config entry");
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper hover:bg-ink/90"
      >
        New entry
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-line bg-card px-5 py-4 space-y-3">
      <h3 className="font-medium text-ink text-sm">New config entry</h3>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-ink-muted mb-1">Key <span className="text-red-500">*</span></label>
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="mcp.max_results"
            className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink font-mono focus:outline-none focus:ring-1 focus:ring-ink"
            required
            pattern="[a-z0-9_.:\-]+"
            title="Lowercase letters, digits, dot, underscore, colon or dash only"
          />
        </div>
        <div>
          <label className="block text-xs text-ink-muted mb-1">Environment</label>
          <input
            value={environment}
            onChange={(e) => setEnvironment(e.target.value)}
            placeholder="production (optional)"
            className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-ink"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-ink-muted mb-1">Value <span className="text-red-500">*</span></label>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="20"
            className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink font-mono focus:outline-none focus:ring-1 focus:ring-ink"
            required
          />
        </div>
        <div>
          <label className="block text-xs text-ink-muted mb-1">Description <span className="text-red-500">*</span></label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What does this setting control?"
            className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-ink"
            required
          />
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper hover:bg-ink/90 disabled:opacity-60"
        >
          {saving ? "Creating…" : "Create"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-ink-muted hover:text-ink">
          Cancel
        </button>
      </div>
    </form>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function FlagsConfigPage() {
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [configs, setConfigs] = useState<AppConfig[]>([]);
  const [flagsLoading, setFlagsLoading] = useState(true);
  const [configsLoading, setConfigsLoading] = useState(true);
  const [flagsError, setFlagsError] = useState<string | null>(null);
  const [configsError, setConfigsError] = useState<string | null>(null);
  const [editingConfig, setEditingConfig] = useState<AppConfig | null>(null);

  useEffect(() => {
    adminFlagApi.list()
      .then((r) => setFlags(r.flags))
      .catch((e: Error) => setFlagsError(e.message))
      .finally(() => setFlagsLoading(false));

    adminConfigApi.list()
      .then((r) => setConfigs(r.entries))
      .catch((e: Error) => setConfigsError(e.message))
      .finally(() => setConfigsLoading(false));
  }, []);

  const handleToggle = async (key: string) => {
    try {
      const { flag } = await adminFlagApi.toggle(key);
      setFlags((prev) => prev.map((f) => (f.key === key ? flag : f)));
    } catch (e: unknown) {
      alert(`Toggle failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleDeleteFlag = async (key: string) => {
    if (!confirm(`Delete flag "${key}"? This cannot be undone.`)) return;
    try {
      await adminFlagApi.delete(key);
      setFlags((prev) => prev.filter((f) => f.key !== key));
    } catch (e: unknown) {
      alert(`Delete failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleDeleteConfig = async (key: string) => {
    if (!confirm(`Delete config entry "${key}"? This cannot be undone.`)) return;
    try {
      await adminConfigApi.delete(key);
      setConfigs((prev) => prev.filter((e) => e.key !== key));
    } catch (e: unknown) {
      alert(`Delete failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleConfigSaved = (saved: AppConfig) => {
    setConfigs((prev) => prev.map((e) => (e.key === saved.key ? saved : e)));
    setEditingConfig(null);
  };

  return (
    <div className="min-h-screen bg-grain px-6 py-12">
      <div className="mx-auto max-w-5xl space-y-12">

        {/* Feature flags */}
        <section>
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="h-2 w-2 rounded-full bg-save" />
              <h1 className="font-display text-3xl text-ink">Feature flags</h1>
            </div>
            <NewFlagForm onCreated={(flag) => setFlags((prev) => [...prev, flag])} />
          </div>

          {flagsError && (
            <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {flagsError}
            </p>
          )}
          {flagsLoading && <p className="text-sm text-ink-muted">Loading…</p>}
          {!flagsLoading && flags.length === 0 && (
            <p className="text-sm text-ink-muted">No feature flags yet. Create one to get started.</p>
          )}
          {!flagsLoading && flags.length > 0 && (
            <div className="space-y-2" data-testid="flags-list">
              {flags.map((flag) => (
                <FlagRow
                  key={flag.key}
                  flag={flag}
                  onToggle={handleToggle}
                  onDelete={handleDeleteFlag}
                />
              ))}
            </div>
          )}
        </section>

        {/* App config */}
        <section>
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="h-2 w-2 rounded-full bg-ink" />
              <h2 className="font-display text-3xl text-ink">App config</h2>
            </div>
            <NewConfigForm onCreated={(entry) => setConfigs((prev) => [...prev, entry])} />
          </div>

          <p className="mb-4 text-xs text-ink-muted">
            Non-secret operational settings consumed by services and channels.
            Never put secrets here — use Azure Key Vault instead.
          </p>

          {configsError && (
            <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {configsError}
            </p>
          )}
          {configsLoading && <p className="text-sm text-ink-muted">Loading…</p>}
          {!configsLoading && configs.length === 0 && (
            <p className="text-sm text-ink-muted">No config entries yet.</p>
          )}
          {!configsLoading && configs.length > 0 && (
            <div className="space-y-2" data-testid="config-list">
              {configs.map((entry) => (
                <ConfigRow
                  key={entry.key}
                  entry={entry}
                  onEdit={setEditingConfig}
                  onDelete={handleDeleteConfig}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      {editingConfig && (
        <EditConfigModal
          entry={editingConfig}
          onSaved={handleConfigSaved}
          onClose={() => setEditingConfig(null)}
        />
      )}
    </div>
  );
}
