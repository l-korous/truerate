// Reproduce the prod POST /memberships 500 against the Cosmos emulator.
// Mimics the api flow: create user -> read back -> push membership -> replace.
import { CosmosClient } from "@azure/cosmos";
import { randomUUID } from "node:crypto";
import { getProgram, instantiateBenefits } from "./dist/index.js";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // emulator self-signed cert
const endpoint = "https://localhost:8081";
const key = "C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==";

const client = new CosmosClient({ endpoint, key });

function makeCatalogMembership() {
  const p = getProgram("booking_genius");
  return {
    id: randomUUID(),
    label: "Booking.com Genius - Level 3",
    programId: p.id,
    tier: "Level 3",
    attributes: {},
    benefits: instantiateBenefits(p, "Level 3"),
    addedAt: new Date().toISOString(),
    status: "active",
  };
}
function makeCustomMembership() {
  return {
    id: randomUUID(),
    label: "Test Custom",
    attributes: {},
    benefits: [{ id: randomUUID(), scope: "brand", match: { brands: ["Marriott"] }, value: { kind: "perk", perks: ["Free breakfast"] }, source: "user-declared" }],
    addedAt: new Date().toISOString(),
    status: "active",
  };
}

async function run() {
  console.log("init db/container...");
  const { database } = await client.databases.createIfNotExists({ id: "truerate" });
  const { container } = await database.containers.createIfNotExists({ id: "users", partitionKey: { paths: ["/id"] } });

  for (const [label, makeMembership] of [["CATALOG (booking_genius)", makeCatalogMembership], ["CUSTOM", makeCustomMembership]]) {
    const uid = randomUUID();
    const user = { id: uid, email: `${uid}@x.com`, passwordHash: "h", memberships: [], createdAt: new Date().toISOString(), activationMilestones: { signup: new Date().toISOString() } };
    await container.items.create(user); // register
    const { resource: read } = await container.item(uid, uid).read(); // loadUser
    read.memberships.push(makeMembership()); // add membership
    read.activationMilestones.membership_added = new Date().toISOString();
    try {
      await container.item(uid, uid).replace(read); // saveUser
      console.log(`\n✅ ${label}: replace OK`);
    } catch (e) {
      console.log(`\n❌ ${label}: replace FAILED`);
      console.log("  code:", e.code, "| statusCode:", e.statusCode, "| name:", e.name);
      console.log("  message:", (e.message || "").slice(0, 600));
      if (e.body) console.log("  body:", JSON.stringify(e.body).slice(0, 600));
    }
  }
}
run().then(() => process.exit(0)).catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
