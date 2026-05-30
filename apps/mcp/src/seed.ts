import { sign } from "hono/jwt";
import {
  getProgram,
  getUserRepo,
  instantiateBenefits,
  type Benefit,
  type Membership,
  type User,
} from "@truerate/core";

// Dev-only seed for test-driving the MCP server with dummy data (e.g. in Claude
// Desktop). The API and MCP servers each keep their own in-memory store when
// TRUERATE_INMEMORY=true, so the MCP process must seed its OWN store — otherwise
// memberships you add via the API in a different process are invisible here.
//
// Gated by TRUERATE_DEV_SEED=true. NEVER enabled in production.

const DEV_USER_ID = "truerate-dev-user";
const DEV_EMAIL = "demo@truerate.dev";

function catalogMembership(programId: string, tier?: string): Membership {
  const program = getProgram(programId)!;
  return {
    id: `dev-${programId}`,
    label: tier ? `${program.name} — ${tier}` : program.name,
    programId,
    tier,
    attributes: {},
    benefits: instantiateBenefits(program, tier),
    addedAt: new Date().toISOString(),
    status: "active",
  };
}

function customMembership(): Membership {
  const benefit: Benefit = {
    id: "dev-pecr",
    scope: "property",
    match: { domains: ["pecr.cz"], propertyNames: ["Hotel PECR"] },
    value: { kind: "percentDiscount", percentOff: 0.15, conditions: "direct booking" },
    source: "user-declared",
  };
  return {
    id: "dev-custom-pecr",
    label: "Hotel PECR (negotiated rate)",
    attributes: {},
    benefits: [benefit],
    addedAt: new Date().toISOString(),
    status: "active",
  };
}

/** Seed a dummy user with a realistic membership stack and return a JWT. */
export async function seedDevUser(): Promise<string> {
  const repo = await getUserRepo();
  const user: User = {
    id: DEV_USER_ID,
    email: DEV_EMAIL,
    passwordHash: "x", // unused by the MCP surface
    memberships: [
      catalogMembership("booking_genius", "Level 3"),
      catalogMembership("marriott_bonvoy", "Platinum"),
      catalogMembership("hilton_honors", "Gold"),
      catalogMembership("revolut", "Metal"),
      customMembership(),
    ],
    createdAt: new Date().toISOString(),
    market: "cz",
    currency: "EUR",
  };
  await repo.create(user);

  const secret = process.env.TRUERATE_JWT_SECRET;
  if (!secret) throw new Error("TRUERATE_JWT_SECRET must be set to mint a dev token.");
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30;
  return sign({ sub: DEV_USER_ID, email: DEV_EMAIL, exp }, secret, "HS256");
}
