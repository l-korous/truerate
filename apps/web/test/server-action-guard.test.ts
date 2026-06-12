import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { middleware } from "../middleware.js";

// Regression guard for: "Cannot read properties of undefined (reading 'workers')"
// Next.js's action-dispatcher Proxy getter crashes when a Next-Action request
// carries an action ID that isn't in the current deployment's manifest.
// The middleware must intercept these requests before they reach the handler.

test("middleware: rejects request with next-action header (no server actions in this app)", async () => {
  const req = new NextRequest("http://localhost/", {
    method: "POST",
    headers: {
      "next-action": "d0ca1fb884a0885833c01b25f3967afcefcbad4a",
      "content-type": "application/json",
    },
  });
  const res = await middleware(req);
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, "server_action_not_found");
});

test("middleware: rejects next-action requests to any path", async () => {
  const req = new NextRequest("http://localhost/en/dashboard", {
    method: "POST",
    headers: { "next-action": "aabbccddeeff00112233445566778899aabbccdd" },
  });
  const res = await middleware(req);
  assert.equal(res.status, 404);
});

test("middleware: allows normal requests without next-action header to pass through", async () => {
  // Admin login is exempt from auth — should NOT get a 404 action guard response.
  const req = new NextRequest("http://localhost/admin/login");
  const res = await middleware(req);
  assert.notEqual(res.status, 404, "normal GET should not be blocked by action guard");
});
