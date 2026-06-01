const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8787";

interface ClientErrorReport {
  source: "web";
  message: string;
  stack?: string;
  url?: string;
  correlationId?: string;
  context?: Record<string, unknown>;
}

/** Field names stripped from context before sending — belt-and-suspenders. */
const SCRUB = /password|token|secret|key|email|price|amount|nightly|total|credit|card|auth/i;

function scrubContext(ctx: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(ctx).filter(([k]) => !SCRUB.test(k)));
}

export function reportError(
  message: string,
  opts: { stack?: string; url?: string; correlationId?: string; context?: Record<string, unknown> } = {},
): void {
  const report: ClientErrorReport = {
    source: "web",
    message: message.slice(0, 500),
    stack: opts.stack?.slice(0, 2000),
    url: opts.url ?? (typeof window !== "undefined" ? window.location.href.slice(0, 300) : undefined),
    correlationId: opts.correlationId,
    context: opts.context ? scrubContext(opts.context) : undefined,
  };
  // Fire-and-forget; never throw from an error reporter.
  fetch(`${API}/client-errors`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(report),
  }).catch(() => undefined);
}

/** Installs global window handlers. Call once from a client component. */
export function installGlobalHandlers(): void {
  if (typeof window === "undefined") return;

  window.addEventListener("error", (ev) => {
    const err = ev.error instanceof Error ? ev.error : null;
    reportError(ev.message || "unhandled error", {
      stack: err?.stack,
      context: { filename: ev.filename, lineno: ev.lineno, colno: ev.colno },
    });
  });

  window.addEventListener("unhandledrejection", (ev) => {
    const reason = ev.reason;
    const message =
      reason instanceof Error ? reason.message : String(reason ?? "unhandled promise rejection");
    const stack = reason instanceof Error ? reason.stack : undefined;
    reportError(message, { stack });
  });
}
