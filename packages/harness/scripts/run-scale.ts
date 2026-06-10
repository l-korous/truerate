#!/usr/bin/env tsx
// Operator-triggered scale harness runner (#335).
//
// Usage (via .github/workflows/scale-harness.yml):
//   SCALE_API_URL=https://api.truerate.app \
//   SCALE_MCP_URL=https://mcp.truerate.app \
//   SCALE_N=1000 SCALE_SEED=0 SCALE_CONCURRENCY=10 \
//   node --import tsx packages/harness/scripts/run-scale.ts
//
// Direct manual run:
//   pnpm --filter @truerate/harness tsx scripts/run-scale.ts \
//     --api-url https://api.truerate.app \
//     --mcp-url https://mcp.truerate.app \
//     --n 1000 --seed 0 --concurrency 10

import { writeFileSync } from "node:fs";
import { createScaleRunner } from "../src/runner.js";

const apiBaseUrl =
  process.env.SCALE_API_URL ??
  (() => {
    throw new Error("SCALE_API_URL is required");
  })();
const mcpBaseUrl =
  process.env.SCALE_MCP_URL ??
  (() => {
    throw new Error("SCALE_MCP_URL is required");
  })();

const n = Number(process.env.SCALE_N ?? "1000");
const seed = Number(process.env.SCALE_SEED ?? "0");
const concurrency = Number(process.env.SCALE_CONCURRENCY ?? "10");

console.log(`TrueRate scale harness (#335)`);
console.log(`  API: ${apiBaseUrl}`);
console.log(`  MCP: ${mcpBaseUrl}`);
console.log(`  N=${n} seed=${seed} concurrency=${concurrency}`);
console.log(`  Starting...`);

const runner = createScaleRunner({
  apiBaseUrl,
  mcpBaseUrl,
  n,
  seed,
  concurrency,
  delayMs: 50, // 50 ms delay between persona slots to be polite to the server
  runIdPrefix: `scale-${seed}-`,
});

const report = await runner.run();

console.log(`\n── Run complete ──────────────────────────────────────────`);
console.log(`  Passed:     ${report.passed} / ${report.n}`);
console.log(`  Failed:     ${report.failed}`);
console.log(`  Duration:   ${(report.durationMs / 1000).toFixed(1)}s`);
console.log(`  Latency:    p50=${report.p50Ms}ms  p95=${report.p95Ms}ms  p99=${report.p99Ms}ms  max=${report.maxMs}ms`);
console.log(`  Channels:`);
console.log(`    Registered:        ${report.channels.registered}`);
console.log(`    Memberships added: ${report.channels.membershipsAdded}`);
console.log(`    MCP tokens issued: ${report.channels.mcpTokensIssued}`);
console.log(`    MCP summaries:     ${report.channels.mcpSummaryCalls}`);
console.log(`    MCP searches:      ${report.channels.mcpSearchCalls}`);

if (report.failed > 0) {
  console.log(`\n── Failures ──────────────────────────────────────────────`);
  for (const detail of report.details.filter((d) => !d.ok)) {
    console.log(`  [${detail.handle}]`);
    for (const f of detail.failures) {
      console.log(`    • ${f}`);
    }
  }
}

// Write JSON report artifact (uploaded by the workflow).
const reportPath = "scale-report.json";
writeFileSync(
  reportPath,
  JSON.stringify({ ...report, details: report.details.filter((d) => !d.ok) }, null, 2),
);
console.log(`\nReport written to ${reportPath} (failures only in details).`);

if (report.failed > 0) {
  console.error(`\nFAILED: ${report.failed} persona(s) did not complete successfully.`);
  process.exit(1);
}

console.log(`\nPASSED: all ${report.passed} personas completed successfully.`);
