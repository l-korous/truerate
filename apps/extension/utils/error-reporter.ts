import type { ClientErrorReport, ClientErrorSource } from "@truerate/core";
import { API_BASE } from "./api";

/** Field names stripped from context before sending. */
const SCRUB = /password|token|secret|key|email|price|amount|nightly|total|credit|card|auth/i;

function scrubContext(ctx: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(ctx).filter(([k]) => !SCRUB.test(k)));
}

export function reportError(
  source: ClientErrorSource,
  message: string,
  opts: { stack?: string; url?: string; context?: Record<string, unknown> } = {},
): void {
  const report: ClientErrorReport = {
    source,
    message: message.slice(0, 500),
    stack: opts.stack?.slice(0, 2000),
    url: opts.url?.slice(0, 300),
    context: opts.context ? scrubContext(opts.context) : undefined,
  };
  // Fire-and-forget; must never throw.
  fetch(`${API_BASE}/client-errors`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(report),
  }).catch(() => undefined);
}

/** Installs global error handlers for a window-based context (content / popup). */
export function installWindowHandlers(source: ClientErrorSource): void {
  window.addEventListener("error", (ev) => {
    const err = ev.error instanceof Error ? ev.error : null;
    reportError(source, ev.message || "unhandled error", {
      stack: err?.stack,
      url: window.location.href,
      context: { filename: ev.filename, lineno: ev.lineno, colno: ev.colno },
    });
  });

  window.addEventListener("unhandledrejection", (ev) => {
    const reason = ev.reason;
    const message =
      reason instanceof Error ? reason.message : String(reason ?? "unhandled promise rejection");
    reportError(source, message, {
      stack: reason instanceof Error ? reason.stack : undefined,
      url: window.location.href,
    });
  });
}

/** Installs global error handlers for the MV3 service worker context. */
export function installServiceWorkerHandlers(): void {
  self.addEventListener("error", (ev) => {
    reportError("extension-background", (ev as ErrorEvent).message || "sw error", {
      stack: (ev as ErrorEvent).error instanceof Error ? (ev as ErrorEvent).error.stack : undefined,
    });
  });

  self.addEventListener("unhandledrejection", (ev) => {
    const reason = (ev as PromiseRejectionEvent).reason;
    const message =
      reason instanceof Error ? reason.message : String(reason ?? "unhandled rejection");
    reportError("extension-background", message, {
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });
}
