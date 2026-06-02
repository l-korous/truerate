/**
 * Seed script: loads all programs from programs.ts into the Cosmos catalog
 * container as published records with provenance=manual-seed.
 *
 * Idempotent: uses upsert, so re-running is always safe.
 *
 * Usage:
 *   pnpm --filter @truerate/core seed:catalog
 *
 * Required env (Cosmos):
 *   COSMOS_ENDPOINT   — Cosmos DB account endpoint
 *   COSMOS_KEY        — key auth (local); omit to use managed identity (Azure)
 *   COSMOS_DATABASE   — database name (default: "truerate")
 */

import { getCatalogRepo, toCatalogProgram } from "../src/catalog-repo.js";
import { PROGRAMS } from "../src/programs.js";

async function main() {
  console.log(`Seeding ${PROGRAMS.length} programs into catalog…`);

  const repo = await getCatalogRepo();

  let seeded = 0;
  for (const program of PROGRAMS) {
    const doc = toCatalogProgram(program, {
      provenance: "manual-seed",
      status: "published",
    });
    await repo.upsert(doc);
    seeded++;
    console.log(`  [${seeded}/${PROGRAMS.length}] ${program.id}`);
  }

  console.log(`Done — ${seeded} programs seeded.`);
}

main().catch((err) => {
  console.error("seed-catalog failed:", err);
  process.exit(1);
});
