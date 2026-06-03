"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type McpStatus =
  | { active: false }
  | { active: true; createdAt: string; lastUsedAt?: string };

/** Builds the ready-to-paste Claude Desktop mcpServers config snippet. */
export function buildClaudeDesktopSnippet(url: string): string {
  const config = {
    mcpServers: {
      truerate: {
        command: "npx",
        args: ["-y", "mcp-remote", url],
      },
    },
  };
  return JSON.stringify(config, null, 2);
}

/** Formats an ISO date string as a human-readable local date. */
export function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function CopyButton({ text, label, testId }: { text: string; label: string; testId?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard API unavailable (e.g. http) — silently ignore */
    }
  }

  return (
    <button
      className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-medium text-ink transition hover:border-ink/40 hover:bg-gray-50"
      onClick={copy}
      data-testid={testId}
    >
      {copied ? "Copied!" : label}
    </button>
  );
}

export function McpUrlManager() {
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [issuedUrl, setIssuedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getMcpUrlStatus()
      .then(setStatus)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function issue() {
    setError(null);
    setActionLoading(true);
    try {
      const result = await api.issueMcpUrl();
      setIssuedUrl(result.url);
      setStatus({ active: true, createdAt: result.createdAt });
      api.trackActivation("mcp_url_obtained");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to issue MCP URL");
    } finally {
      setActionLoading(false);
    }
  }

  async function revoke() {
    setError(null);
    setActionLoading(true);
    try {
      await api.revokeMcpUrl();
      setStatus({ active: false });
      setIssuedUrl(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to revoke MCP URL");
    } finally {
      setActionLoading(false);
    }
  }

  if (loading) return <p className="text-sm text-ink-muted">Loading…</p>;

  const snippet = issuedUrl ? buildClaudeDesktopSnippet(issuedUrl) : null;

  return (
    <div className="space-y-6" data-testid="mcp-url-manager">
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600" data-testid="mcp-error">
          {error}
        </div>
      )}

      {/* Status card */}
      <div className="rounded-xl2 border border-line bg-card p-6">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-xl text-ink">Your personal MCP URL</h2>
            <p className="mt-1 text-sm text-ink-muted">
              Connect your AI assistant (Claude Desktop, Cursor, …) to your membership vault.
            </p>
          </div>
          <span
            className={`mt-0.5 shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
              status?.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
            }`}
            data-testid="mcp-status-badge"
          >
            {status?.active ? "Active" : "Inactive"}
          </span>
        </div>

        {status?.active && (
          <p className="mb-4 text-xs text-ink-muted" data-testid="mcp-created-at">
            Issued {formatDate(status.createdAt)}
            {status.lastUsedAt && ` · Last used ${formatDate(status.lastUsedAt)}`}
          </p>
        )}

        {/* Issued URL — shown exactly once after issue/rotate */}
        {issuedUrl ? (
          <div className="space-y-3">
            <div
              className="flex items-center gap-2 rounded-lg border border-line bg-white p-3"
              data-testid="mcp-url-display"
            >
              <code className="min-w-0 flex-1 break-all text-xs text-ink">{issuedUrl}</code>
              <CopyButton text={issuedUrl} label="Copy URL" testId="copy-url-btn" />
            </div>
            <p className="text-xs text-amber-600" data-testid="mcp-one-time-notice">
              Save this URL now — it won&apos;t be shown again. Rotate to get a new one if you lose it.
            </p>
          </div>
        ) : status?.active ? (
          <div className="rounded-lg border border-dashed border-line bg-white/50 px-4 py-3 text-sm text-ink-muted" data-testid="mcp-url-hidden">
            URL is not shown after the initial issue. Rotate below to get a new one.
          </div>
        ) : null}

        {/* Actions */}
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            className="btn-primary"
            disabled={actionLoading}
            onClick={issue}
            data-testid={status?.active ? "rotate-btn" : "issue-btn"}
          >
            {actionLoading ? "…" : status?.active ? "Rotate URL" : "Get my MCP URL"}
          </button>
          {status?.active && (
            <button
              className="rounded-xl border border-red-200 px-4 py-2 text-sm font-medium text-red-600 transition hover:border-red-400 hover:bg-red-50"
              disabled={actionLoading}
              onClick={revoke}
              data-testid="revoke-btn"
            >
              Revoke
            </button>
          )}
        </div>
      </div>

      {/* Claude Desktop snippet — only visible when URL is known */}
      {snippet && (
        <div className="rounded-xl2 border border-line bg-card p-6" data-testid="claude-desktop-section">
          <div className="mb-3 flex items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-xl text-ink">Claude Desktop config</h2>
              <p className="mt-1 text-sm text-ink-muted">
                Add this to your{" "}
                <code className="rounded bg-gray-100 px-1 py-0.5 text-xs">claude_desktop_config.json</code>{" "}
                and restart Claude Desktop.
              </p>
            </div>
            <CopyButton text={snippet} label="Copy snippet" testId="copy-snippet-btn" />
          </div>
          <pre
            className="overflow-x-auto rounded-lg bg-gray-50 p-4 text-xs leading-relaxed text-ink"
            data-testid="claude-desktop-snippet"
          >
            {snippet}
          </pre>
          <p className="mt-3 text-xs text-ink-muted">
            Config file location: <code className="rounded bg-gray-100 px-1 py-0.5">~/Library/Application Support/Claude/claude_desktop_config.json</code>{" "}
            (macOS) · <code className="rounded bg-gray-100 px-1 py-0.5">%APPDATA%\Claude\claude_desktop_config.json</code> (Windows)
          </p>
        </div>
      )}
    </div>
  );
}
