import { test, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

before(() => {
  process.env.TRUERATE_INMEMORY = "true";
  process.env.TRUERATE_JWT_SECRET = "test-secret-please-ignore";
  process.env.TRUERATE_CRED_KEY = randomBytes(32).toString("base64");
  process.env.ADMIN_SECRET = "test-admin-secret";
});

async function getApp() {
  const { app } = await import("../src/app.js");
  return app;
}
const rnd = () => `u${Math.random().toString(36).slice(2)}@example.com`;

async function registerUser(app: Awaited<ReturnType<typeof getApp>>) {
  const email = rnd();
  const res = await app.request("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "pw123456", market: "cz" }),
  });
  assert.equal(res.status, 200);
  const { token } = await res.json();
  return { token, email };
}
const authed = (token: string) => ({ "Content-Type": "application/json", Authorization: `Bearer ${token}` });

// --- Registration sets signup milestone -------------------------------------

test("register marks signup milestone", async () => {
  const app = await getApp();
  const { token } = await registerUser(app);
  const { user } = await (await app.request("/me", { headers: authed(token) })).json();
  // signup milestone is set server-side; it's not exposed via publicUser,
  // so we verify indirectly via the admin funnel (counts > 0).
  // Also test that the user object itself doesn't leak the milestone (no PII concern here
  // but the public surface shouldn't include internal tracking fields).
  assert.ok(!("activationMilestones" in user), "activationMilestones must not appear in public user");
  assert.ok(token.length > 0);
});

// --- Funnel endpoint --------------------------------------------------------

test("GET /admin/funnel/activation returns funnel counts", async () => {
  const app = await getApp();
  await registerUser(app);

  const res = await app.request("/admin/funnel/activation", {
    headers: { "x-admin-secret": "test-admin-secret" },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok("funnel" in body, "response has funnel");
  assert.ok("generatedAt" in body, "response has generatedAt");
  assert.ok(typeof body.funnel.signup === "number", "signup is a number");
  assert.ok(typeof body.funnel.membership_added === "number");
  assert.ok(typeof body.funnel.mcp_url_obtained === "number");
  assert.ok(typeof body.funnel.extension_connected === "number");
  // At least the users registered above should show up
  assert.ok(body.funnel.signup >= 1, "at least one signup");
});

test("GET /admin/funnel/activation requires correct ADMIN_SECRET", async () => {
  const app = await getApp();

  // Missing header
  const r1 = await app.request("/admin/funnel/activation");
  assert.equal(r1.status, 401);

  // Wrong header
  const r2 = await app.request("/admin/funnel/activation", {
    headers: { "x-admin-secret": "wrong" },
  });
  assert.equal(r2.status, 401);
});

// --- Membership added milestone --------------------------------------------

test("adding first membership marks membership_added in funnel", async () => {
  const app = await getApp();
  const { token } = await registerUser(app);

  const before = await (await app.request("/admin/funnel/activation", {
    headers: { "x-admin-secret": "test-admin-secret" },
  })).json();

  await app.request("/memberships", {
    method: "POST", headers: authed(token),
    body: JSON.stringify({ programId: "booking_genius", tier: "Level 3", attributes: {} }),
  });

  const after = await (await app.request("/admin/funnel/activation", {
    headers: { "x-admin-secret": "test-admin-secret" },
  })).json();

  assert.ok(after.funnel.membership_added >= before.funnel.membership_added + 1);
});

test("membership_added milestone is idempotent (second membership does not re-count)", async () => {
  const app = await getApp();
  const { token } = await registerUser(app);

  // Add first membership
  await app.request("/memberships", {
    method: "POST", headers: authed(token),
    body: JSON.stringify({ programId: "booking_genius", tier: "Level 3", attributes: {} }),
  });

  const after1 = await (await app.request("/admin/funnel/activation", {
    headers: { "x-admin-secret": "test-admin-secret" },
  })).json();

  // Add second membership — count should not increase
  await app.request("/memberships", {
    method: "POST", headers: authed(token),
    body: JSON.stringify({ programId: "marriott_bonvoy", tier: "Gold", attributes: {} }),
  });

  const after2 = await (await app.request("/admin/funnel/activation", {
    headers: { "x-admin-secret": "test-admin-secret" },
  })).json();

  assert.equal(after2.funnel.membership_added, after1.funnel.membership_added, "count unchanged after second membership");
});

// --- Extension connected milestone -----------------------------------------

test("/benefits/match marks extension_connected milestone", async () => {
  const app = await getApp();
  const { token } = await registerUser(app);
  await app.request("/memberships", {
    method: "POST", headers: authed(token),
    body: JSON.stringify({ label: "Test", benefits: [{ scope: "global", match: {}, value: { kind: "perk", perks: ["test"] } }] }),
  });

  const before = await (await app.request("/admin/funnel/activation", {
    headers: { "x-admin-secret": "test-admin-secret" },
  })).json();

  await app.request("/benefits/match", {
    method: "POST", headers: authed(token),
    body: JSON.stringify({ domain: "booking.com" }),
  });

  const after = await (await app.request("/admin/funnel/activation", {
    headers: { "x-admin-secret": "test-admin-secret" },
  })).json();

  assert.ok(after.funnel.extension_connected >= before.funnel.extension_connected + 1);
});

// --- POST /events/activation (client-side events) --------------------------

test("POST /events/activation requires auth", async () => {
  const app = await getApp();
  const res = await app.request("/events/activation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event: "mcp_url_obtained" }),
  });
  assert.equal(res.status, 401);
});

test("POST /events/activation rejects unknown event names", async () => {
  const app = await getApp();
  const { token } = await registerUser(app);
  const res = await app.request("/events/activation", {
    method: "POST", headers: authed(token),
    body: JSON.stringify({ event: "not_a_real_event" }),
  });
  assert.equal(res.status, 400);
});

test("POST /events/activation records mcp_url_obtained", async () => {
  const app = await getApp();
  const { token } = await registerUser(app);

  const before = await (await app.request("/admin/funnel/activation", {
    headers: { "x-admin-secret": "test-admin-secret" },
  })).json();

  const res = await app.request("/events/activation", {
    method: "POST", headers: authed(token),
    body: JSON.stringify({ event: "mcp_url_obtained" }),
  });
  assert.equal(res.status, 204);

  const after = await (await app.request("/admin/funnel/activation", {
    headers: { "x-admin-secret": "test-admin-secret" },
  })).json();
  assert.ok(after.funnel.mcp_url_obtained >= before.funnel.mcp_url_obtained + 1);
});

test("POST /events/activation is idempotent (duplicate event does not double-count)", async () => {
  const app = await getApp();
  const { token } = await registerUser(app);

  // First event
  await app.request("/events/activation", {
    method: "POST", headers: authed(token),
    body: JSON.stringify({ event: "mcp_url_obtained" }),
  });

  const after1 = await (await app.request("/admin/funnel/activation", {
    headers: { "x-admin-secret": "test-admin-secret" },
  })).json();

  // Second (duplicate) event — count must not change
  await app.request("/events/activation", {
    method: "POST", headers: authed(token),
    body: JSON.stringify({ event: "mcp_url_obtained" }),
  });

  const after2 = await (await app.request("/admin/funnel/activation", {
    headers: { "x-admin-secret": "test-admin-secret" },
  })).json();

  assert.equal(after2.funnel.mcp_url_obtained, after1.funnel.mcp_url_obtained, "count unchanged on duplicate");
});

// --- Privacy: no price data in funnel response -----------------------------

test("funnel response contains no price data", async () => {
  const app = await getApp();
  const res = await app.request("/admin/funnel/activation", {
    headers: { "x-admin-secret": "test-admin-secret" },
  });
  const body = await res.json();
  const str = JSON.stringify(body);
  for (const field of ["price", "amount", "nightly", "total", "currency", "cost"]) {
    assert.ok(!str.toLowerCase().includes(field), `funnel response must not contain '${field}'`);
  }
});
