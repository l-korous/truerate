/**
 * OpenTelemetry setup for TrueRate Node.js services (api, mcp).
 *
 * Call `setupTelemetry(serviceName)` once, as the very first thing in the
 * process entry point (before any other imports), so HTTP instrumentation
 * registers before the HTTP server is created.
 *
 * Disabled automatically when APPLICATIONINSIGHTS_CONNECTION_STRING is unset.
 *
 * Sampling strategy (tail-based at the exporter level):
 *   - Spans with ERROR status or an "exception" event are always exported.
 *   - Other spans are randomly exported at OTEL_SAMPLE_RATE (default 0.05 = 5%).
 * Head-sampling is skipped intentionally so we never discard a span whose error
 * is only known at span end — the sampling decision happens at export time.
 *
 * No price data, tokens, or secrets may appear in span attributes or events.
 * Perk-value estimates are the only numeric values that may be traced.
 */
import { NodeSDK } from "@opentelemetry/sdk-node";
import type { SpanExporter, ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { ExportResultCode } from "@opentelemetry/core";
import type { ExportResult } from "@opentelemetry/core";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { AzureMonitorTraceExporter } from "@azure/monitor-opentelemetry-exporter";
import { SpanStatusCode } from "@opentelemetry/api";

/**
 * Tail-based sampling exporter wrapper.
 * Errors/exceptions are always forwarded; normal spans are sampled at `rate`.
 */
class FilteringExporter implements SpanExporter {
  constructor(
    private readonly inner: SpanExporter,
    private readonly rate: number,
  ) {}

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    const filtered = spans.filter((s) => {
      if (s.status.code === SpanStatusCode.ERROR) return true;
      if (s.events.some((e) => e.name === "exception")) return true;
      return Math.random() < this.rate;
    });
    if (filtered.length === 0) {
      resultCallback({ code: ExportResultCode.SUCCESS });
      return;
    }
    this.inner.export(filtered, resultCallback);
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }

  forceFlush(): Promise<void> {
    const inner = this.inner as SpanExporter & { forceFlush?(): Promise<void> };
    return inner.forceFlush?.() ?? Promise.resolve();
  }
}

let _sdk: NodeSDK | null = null;

/**
 * Initialize OTel for the given service.
 * No-op when APPLICATIONINSIGHTS_CONNECTION_STRING is not set.
 * Idempotent: calling more than once is safe (second call is a no-op).
 */
export function setupTelemetry(serviceName: string): void {
  if (_sdk) return;

  const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
  if (!connectionString) return;

  const rate = Math.min(1, Math.max(0, Number(process.env.OTEL_SAMPLE_RATE ?? 0.05)));

  const azureExporter = new AzureMonitorTraceExporter({ connectionString });

  _sdk = new NodeSDK({
    serviceName,
    traceExporter: new FilteringExporter(azureExporter, rate),
    instrumentations: [
      new HttpInstrumentation({
        // Sanitize per-user MCP URL tokens so they never appear in span attributes.
        requestHook: (span, req) => {
          const url = "url" in req ? String(req.url ?? "") : "";
          const sanitized = url.replace(/\/u\/[A-Za-z0-9_-]+\//, "/u/[token]/");
          if (sanitized !== url) span.setAttribute("http.target", sanitized);
        },
      }),
    ],
  });

  _sdk.start();

  // Flush on graceful shutdown so in-flight batched spans are not lost.
  process.once("SIGTERM", () => { void _sdk?.shutdown(); });
  process.once("SIGINT", () => { void _sdk?.shutdown(); });
}

/** Visible for tests: reset singleton so setupTelemetry can be called again. */
export function _resetTelemetry(): void {
  void _sdk?.shutdown();
  _sdk = null;
}
