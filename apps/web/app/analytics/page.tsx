"use client";

import { useEffect, useState } from "react";
import type { FunnelReport } from "@/lib/analytics-store";

const STAGE_LABELS: Record<string, string> = {
  landing_visit: "Landing visit",
  sign_up: "Sign-up",
  membership_added: "First membership added (activation)",
  mcp_connect: "MCP connected",
  extension_install: "Extension installed",
};

function pct(n: number | null): string {
  if (n === null) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

export default function AnalyticsDashboard() {
  const [report, setReport] = useState<FunnelReport | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/analytics")
      .then((r) => r.json())
      .then(setReport)
      .catch(() => setError(true));
  }, []);

  const maxCount = report ? Math.max(1, ...Object.values(report.counts)) : 1;

  return (
    <div className="min-h-screen bg-grain px-6 py-12">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 flex items-center gap-3">
          <span className="h-2 w-2 rounded-full bg-save" />
          <h1 className="font-display text-3xl text-ink">Activation funnel</h1>
        </div>

        {error && (
          <p className="text-sm text-red-600">Failed to load analytics data.</p>
        )}

        {!report && !error && (
          <p className="text-sm text-ink-muted">Loading…</p>
        )}

        {report && (
          <>
            <section className="mb-10" data-testid="funnel-chart">
              <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-ink-muted">Funnel</h2>
              <div className="space-y-3">
                {(Object.entries(report.counts) as [string, number][]).map(([name, count]) => (
                  <div key={name} data-testid={`funnel-stage-${name}`}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="font-medium text-ink">{STAGE_LABELS[name] ?? name}</span>
                      <span className="tabular-nums text-ink-muted">{count.toLocaleString()}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-paper">
                      <div
                        className="h-full rounded-full bg-save transition-all"
                        style={{ width: `${(count / maxCount) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="mb-10" data-testid="conversion-rates">
              <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-ink-muted">Conversion rates</h2>
              <div className="grid grid-cols-3 gap-4">
                {[
                  ["Visit → Sign-up", report.conversionRates.visitToSignUp],
                  ["Sign-up → Activation", report.conversionRates.signUpToActivation],
                  ["Overall funnel", report.conversionRates.overallFunnel],
                ].map(([label, value]) => (
                  <div key={label as string} className="rounded-xl border border-line bg-card p-4" data-testid="conversion-card">
                    <p className="text-xs text-ink-muted">{label as string}</p>
                    <p className="mt-1 font-display text-2xl text-ink">{pct(value as number | null)}</p>
                  </div>
                ))}
              </div>
            </section>

            <section data-testid="recent-events">
              <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-ink-muted">Recent events</h2>
              {report.recentEvents.length === 0 ? (
                <p className="text-sm text-ink-muted">No events yet.</p>
              ) : (
                <ul className="space-y-2">
                  {report.recentEvents.map((e) => (
                    <li key={e.id} className="flex items-center justify-between rounded-lg border border-line bg-card px-4 py-2 text-sm">
                      <span className="font-medium text-ink">{STAGE_LABELS[e.name] ?? e.name}</span>
                      <span className="text-ink-muted">{new Date(e.timestamp).toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
