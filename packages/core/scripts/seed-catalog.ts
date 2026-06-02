/**
 * Seed script: loads all programs from programs.ts into the Cosmos catalog
 * container as published records with provenance=manual-seed.
 *
 * Idempotent: already-seeded programs are skipped (seedIfEmpty).
 *
 * Usage:
 *   pnpm --filter @truerate/core seed:catalog
 *
 * Required env (Cosmos):
 *   COSMOS_ENDPOINT   — Cosmos DB account endpoint
 *   COSMOS_KEY        — key auth (local); omit to use managed identity (Azure)
 *   COSMOS_DATABASE   — database name (default: "truerate")
 */

import { getCatalogRepo, programToCatalogInput } from "../src/catalog-db.js";
import { PROGRAMS } from "../src/programs.js";

async function main() {
  console.log(`Seeding up to ${PROGRAMS.length} programs into catalog…`);

  const repo = await getCatalogRepo();
  const inputs = PROGRAMS.map(programToCatalogInput);
  const result = await repo.seedIfEmpty(inputs);

  console.log(`Done — ${result.seeded} programs seeded, ${result.skipped} skipped.`);
}

main().catch((err) => {
  console.error("seed-catalog failed:", err);
  process.exit(1);
});
