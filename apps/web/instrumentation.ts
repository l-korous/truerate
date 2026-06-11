/**
 * Next.js instrumentation hook — called once at server startup.
 * Sets up OpenTelemetry to export to Azure Monitor / App Insights.
 *
 * Disabled automatically when APPLICATIONINSIGHTS_CONNECTION_STRING is unset.
 * Only runs in the Node.js runtime (not the Edge runtime).
 *
 * Sampling: configurable via OTEL_SAMPLE_RATE (default 0.05 = 5%).
 * Error spans and spans with exception events are always exported.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
  if (!connectionString) return;

  const [
    { NodeSDK },
    { ExportResultCode },
    { SpanStatusCode },
    { AzureMonitorTraceExporter },
    { HttpInstrumentation },
  ] = await Promise.all([
    import("@opentelemetry/sdk-node"),
    import("@opentelemetry/core"),
    import("@opentelemetry/api"),
    import("@azure/monitor-opentelemetry-exporter"),
    import("@opentelemetry/instrumentation-http"),
  ]);

  const rate = Math.min(1, Math.max(0, Number(process.env.OTEL_SAMPLE_RATE ?? 0.05)));
  const azureExporter = new AzureMonitorTraceExporter({ connectionString });

  type RS = import("@opentelemetry/sdk-trace-base").ReadableSpan;
  type ER = import("@opentelemetry/core").ExportResult;

  const filteringExporter = {
    export(spans: RS[], resultCallback: (result: ER) => void) {
      const filtered = spans.filter((s) => {
        if (s.status.code === SpanStatusCode.ERROR) return true;
        if (s.events.some((e) => e.name === "exception")) return true;
        return Math.random() < rate;
      });
      if (filtered.length === 0) {
        resultCallback({ code: ExportResultCode.SUCCESS });
        return;
      }
      azureExporter.export(filtered, resultCallback);
    },
    shutdown(): Promise<void> { return azureExporter.shutdown(); },
  };

  const sdk = new NodeSDK({
    serviceName: "truerate-web",
    traceExporter: filteringExporter,
    instrumentations: [new HttpInstrumentation()],
  });

  sdk.start();

  process.once("SIGTERM", () => { void sdk.shutdown(); });
}
