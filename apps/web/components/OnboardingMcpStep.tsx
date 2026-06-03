"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { buildClaudeDesktopSnippet } from "./McpUrlManager";

// ── Types ────────────────────────────────────────────────────────────────────

type McpStatus =
  | { active: false }
  | { active: true; createdAt: string; lastUsedAt?: string };

type Phase = "loading" | "no-url" | "issued" | "active-hidden";

/** Derives the current UI phase from status + whether we just issued a URL. */
export function derivePhase(
  status: McpStatus | null,
  issuedUrl: string | null,
  loading: boolean,
): Phase {
  if (loading || status === null) return "loading";
  if (issuedUrl) return "issued";
  if (status.active) return "active-hidden";
  return "no-url";
}

/** Returns numbered setup steps for connecting Claude Desktop to the given URL. */
export function buildSetupSteps(url: string): Array<{ title: string; detail: string }> {
  return [
    {
      title: "Open Claude Desktop",
      detail: "Make sure you have Claude Desktop installed (claude.ai/download).",
    },
    {
      title: "Edit the config file",
      detail:
        "Open claude_desktop_config.json — on macOS: ~/Library/Application Support/Claude/, on Windows: %APPDATA%\\Claude\\.",
    },
    {
      title: "Add the TrueRate server",
      detail: `Paste the snippet below into the mcpServers section. It tells Claude to connect to your personal URL: ${url}`,
    },
    {
      title: "Restart Claude Desktop",
      detail:
        "Quit and reopen the app. TrueRate will appear in the available MCP tools.",
    },
    {
      title: "Ask about your perks",
      detail:
        'Try: "What hotel perks and discounts do I have for a 4-star hotel in Prague?" — Claude will call TrueRate to answer with applicable discounts (%), perks, conditions, and estimated perk value.',
    },
  ];
}

/** Returns a setup note for non-Claude-Desktop MCP clients. */
export function buildGenericSetupNote(url: string): string {
  return `For Cursor, Windsurf, or other MCP-compatible clients: add a new MCP server with the URL ${url}. Consult your client's docs for the exact config format.`;
}

// ── CopyButton ────────────────────────────────────────────────────────────────

function CopyButton({
  text,
  label,
  testId,
}: {
  text: string;
  label: string;
  testId?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard API unavailable — silently ignore */
    }
  }

  return (
    <button
      className="shrink-0 rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-medium text-ink transition hover:border-ink/40 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40"
      onClick={copy}
      data-testid={testId}
    >
      {copied ? "Copied!" : label}
    </button>
  );
}

// ── ValueProposition ─────────────────────────────────────────────────────────

function ValueProposition() {
  return (
    <div
      className="rounded-xl border border-line bg-card p-5"
      data-testid="mcp-value-proposition"
    >
      <h2 className="font-display text-lg text-ink">
        What your AI assistant will receive
      </h2>
      <ul className="mt-3 space-y-2 text-sm text-ink-muted">
        <li className="flex items-start gap-2">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-save" aria-hidden="true" />
          Applicable membership discounts (%)
        </li>
        <li className="flex items-start gap-2">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-save" aria-hidden="true" />
          Perks and conditions that apply
        </li>
        <li className="flex items-start gap-2">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-save" aria-hidden="true" />
          Estimated perk value (e.g. free breakfast ≈ $20 at 3★, $40 at 4★, $60 at 5★)
        </li>
      </ul>
      <p
        className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700"
        data-testid="mcp-no-prices-notice"
      >
        <strong>No prices — ever.</strong> TrueRate never fetches or returns hotel
        prices. Your AI assistant or the booking channel handles price math using
        the discounts and perk estimates above.
      </p>
    </div>
  );
}

// ── SetupInstructions ────────────────────────────────────────────────────────

function SetupInstructions({ url }: { url: string }) {
  const steps = buildSetupSteps(url);
  const snippet = buildClaudeDesktopSnippet(url);
  const genericNote = buildGenericSetupNote(url);

  return (
    <div
      className="space-y-4"
      data-testid="mcp-setup-instructions"
      aria-label="MCP setup instructions"
    >
      <h2 className="font-display text-xl text-ink">Connect Claude Desktop</h2>

      <ol className="space-y-4">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-4">
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-bold text-paper"
              aria-hidden="true"
            >
              {i + 1}
            </span>
            <div>
              <p className="font-medium text-ink">{step.title}</p>
              <p className="mt-0.5 text-sm text-ink-muted">{step.detail}</p>
            </div>
          </li>
        ))}
      </ol>

      {/* Config snippet */}
      <div
        className="rounded-xl border border-line bg-card p-5"
        data-testid="mcp-config-snippet-section"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-ink">Config snippet (step 3)</p>
          <CopyButton
            text={snippet}
            label="Copy snippet"
            testId="copy-snippet-btn"
          />
        </div>
        <pre
          className="overflow-x-auto rounded-lg bg-gray-50 p-4 text-xs leading-relaxed text-ink"
          data-testid="mcp-config-snippet"
        >
          {snippet}
        </pre>
        <p className="mt-2 text-xs text-ink-muted">
          Config file:{" "}
          <code className="rounded bg-gray-100 px-1 py-0.5">
            ~/Library/Application Support/Claude/claude_desktop_config.json
          </code>{" "}
          (macOS) ·{" "}
          <code className="rounded bg-gray-100 px-1 py-0.5">
            %APPDATA%\Claude\claude_desktop_config.json
          </code>{" "}
          (Windows)
        </p>
      </div>

      {/* Other clients */}
      <p
        className="text-xs text-ink-muted"
        data-testid="mcp-generic-client-note"
      >
        {genericNote}
      </p>
    </div>
  );
}

// ── OnboardingMcpStep (main export) ─────────────────────────────────────────

export function OnboardingMcpStep() {
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
      setError(e instanceof Error ? e.message : "Failed to generate MCP URL");
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

  async function retry() {
    setError(null);
    setLoading(true);
    api
      .getMcpUrlStatus()
      .then(setStatus)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }

  const phase = derivePhase(status, issuedUrl, loading);

  return (
    <div className="space-y-6" data-testid="onboarding-mcp-step">
      {/* Error banner */}
      {error && (
        <div
          className="flex items-center justify-between gap-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600"
          role="alert"
          data-testid="mcp-onboarding-error"
        >
          <span>{error}</span>
          <button
            className="shrink-0 text-xs font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
            onClick={retry}
          >
            Retry
          </button>
        </div>
      )}

      {/* Value proposition — always shown */}
      <ValueProposition />

      {/* URL section */}
      <div
        className="rounded-xl border border-line bg-card p-5"
        data-testid="mcp-url-section"
      >
        <h2 className="font-display text-xl text-ink">Your personal MCP URL</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Each TrueRate account gets a unique MCP endpoint. Guard it like a
          password — anyone with this URL can read your membership vault.
        </p>

        <div className="mt-4 space-y-3">
          {phase === "loading" && (
            <p
              className="text-sm text-ink-muted"
              data-testid="mcp-loading"
              aria-live="polite"
            >
              Loading…
            </p>
          )}

          {phase === "no-url" && (
            <button
              className="btn-primary"
              disabled={actionLoading}
              onClick={issue}
              data-testid="issue-mcp-url-btn"
            >
              {actionLoading ? "Generating…" : "Generate my MCP URL"}
            </button>
          )}

          {phase === "issued" && issuedUrl && (
            <>
              <div
                className="flex items-center gap-2 rounded-lg border border-line bg-white p-3"
                data-testid="mcp-url-display"
              >
                <code className="min-w-0 flex-1 break-all text-xs text-ink">
                  {issuedUrl}
                </code>
                <CopyButton
                  text={issuedUrl}
                  label="Copy URL"
                  testId="copy-url-btn"
                />
              </div>
              <p
                className="text-xs text-amber-600"
                data-testid="mcp-one-time-notice"
              >
                Save this URL now — it won&apos;t be shown again. Rotate below
                to get a new one if you lose it.
              </p>
              <div className="flex flex-wrap gap-3 pt-1">
                <button
                  className="rounded-xl border border-line px-4 py-2 text-sm font-medium text-ink-muted transition hover:border-ink/40 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40"
                  disabled={actionLoading}
                  onClick={issue}
                  data-testid="rotate-btn"
                >
                  {actionLoading ? "…" : "Rotate URL"}
                </button>
                <button
                  className="rounded-xl border border-red-200 px-4 py-2 text-sm font-medium text-red-600 transition hover:border-red-400 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                  disabled={actionLoading}
                  onClick={revoke}
                  data-testid="revoke-btn"
                >
                  Revoke
                </button>
              </div>
            </>
          )}

          {phase === "active-hidden" && (
            <>
              <div
                className="rounded-lg border border-dashed border-line bg-white/50 px-4 py-3 text-sm text-ink-muted"
                data-testid="mcp-url-already-active"
              >
                Your MCP URL is active. Rotate to get a new URL and see the
                setup instructions again.
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  className="btn-primary"
                  disabled={actionLoading}
                  onClick={issue}
                  data-testid="rotate-btn"
                >
                  {actionLoading ? "…" : "Rotate URL"}
                </button>
                <button
                  className="rounded-xl border border-red-200 px-4 py-2 text-sm font-medium text-red-600 transition hover:border-red-400 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                  disabled={actionLoading}
                  onClick={revoke}
                  data-testid="revoke-btn"
                >
                  Revoke
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Setup instructions — only when URL is known this session */}
      {phase === "issued" && issuedUrl && (
        <div data-testid="mcp-setup-section">
          <SetupInstructions url={issuedUrl} />
        </div>
      )}
    </div>
  );
}
