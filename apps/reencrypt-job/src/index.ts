import { CosmosClient } from "@azure/cosmos";
import { DefaultAzureCredential } from "@azure/identity";
import { reEncryptCredential } from "@truerate/core";
import type { User } from "@truerate/core";

// Determine the active key version ID from TRUERATE_CRED_KEY so we can skip
// blobs that are already on the current key and avoid unnecessary writes.
function getActiveVersionId(): string {
  const raw = process.env.TRUERATE_CRED_KEY ?? "";
  const colonIdx = raw.indexOf(":");
  return colonIdx > 0 ? raw.slice(0, colonIdx) : "v1";
}

function needsReEncrypt(blob: string, activeVersionId: string): boolean {
  return !blob.startsWith(`v2:${activeVersionId}:`);
}

async function main(): Promise<void> {
  const endpoint = process.env.COSMOS_ENDPOINT;
  if (!endpoint) throw new Error("COSMOS_ENDPOINT is required.");
  if (!process.env.TRUERATE_CRED_KEY) throw new Error("TRUERATE_CRED_KEY is required.");

  const dryRun = process.env.DRY_RUN === "true";
  const dbName = process.env.COSMOS_DATABASE ?? "truerate";

  const cosmosKey = process.env.COSMOS_KEY;
  const client = cosmosKey
    ? new CosmosClient({ endpoint, key: cosmosKey })
    : new CosmosClient({ endpoint, aadCredentials: new DefaultAzureCredential() });

  const container = client.database(dbName).container("users");
  const activeVersionId = getActiveVersionId();

  console.log(
    `Starting re-encryption job | activeVersion=${activeVersionId} dryRun=${dryRun}`,
  );

  // Cross-partition scan — fine for an infrequent maintenance job.
  const { resources: users } = await container.items.query<User>("SELECT * FROM c").fetchAll();

  let total = 0;
  let reencrypted = 0;
  let skipped = 0;
  let errors = 0;

  for (const user of users) {
    total++;
    let changed = false;

    for (const membership of user.memberships) {
      if (!membership.encryptedCredential) continue;
      if (!needsReEncrypt(membership.encryptedCredential, activeVersionId)) continue;

      try {
        membership.encryptedCredential = reEncryptCredential(membership.encryptedCredential);
        changed = true;
      } catch (err) {
        console.error(
          `Failed to re-encrypt credential for user=${user.id} membership=${membership.id}: ${err}`,
        );
        errors++;
      }
    }

    if (!changed) {
      skipped++;
      continue;
    }

    if (dryRun) {
      console.log(`[DRY RUN] Would update user=${user.id}`);
    } else {
      await container.item(user.id, user.id).replace<User>(user);
      console.log(`Updated user=${user.id}`);
    }
    reencrypted++;
  }

  console.log(
    `summary: total=${total} reencrypted=${reencrypted} skipped=${skipped} errors=${errors} dryRun=${dryRun}`,
  );

  if (errors > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Re-encryption job failed:", err);
  process.exit(1);
});
