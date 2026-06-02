import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { recordEvent, getReport, _clearEvents } from "../lib/analytics-store.js";
import { POST, GET } from "../app/api/analytics/route.js";

describe("analytics-store", () => {
  beforeEach(() => {
    _clearEvents();
  });

  test("records an event and increments its counter in the report", () => {
    recordEvent({ name: "landing_visit", timestamp: new Date().toISOString() });
    const report = getReport();
    assert.equal(report.counts.landing_visit, 1);
  });

  test("counts multiple events independently", () => {
    recordEvent({ name: "landing_visit", timestamp: new Date().toISOString() });
    recordEvent({ name: "landing_visit", timestamp: new Date().toISOString() });
    recordEvent({ name: "sign_up", timestamp: new Date().toISOString() });
    const report = getReport();
    assert.equal(report.counts.landing_visit, 2);
    assert.equal(report.counts.sign_up, 1);
  });

  test("conversion rates are null when no visits recorded", () => {
    const report = getReport();
    assert.equal(report.conversionRates.visitToSignUp, null);
    assert.equal(report.conversionRates.signUpToActivation, null);
    assert.equal(report.conversionRates.overallFunnel, null);
  });

  test("visit-to-signup conversion rate is correct", () => {
    for (let i = 0; i < 4; i++) recordEvent({ name: "landing_visit", timestamp: new Date().toISOString() });
    recordEvent({ name: "sign_up", timestamp: new Date().toISOString() });
    const report = getReport();
    assert.equal(report.conversionRates.visitToSignUp, 0.25);
  });

  test("overall funnel rate accounts for all stages", () => {
    for (let i = 0; i < 10; i++) recordEvent({ name: "landing_visit", timestamp: new Date().toISOString() });
    recordEvent({ name: "sign_up", timestamp: new Date().toISOString() });
    recordEvent({ name: "membership_added", timestamp: new Date().toISOString() });
    const report = getReport();
    assert.equal(report.conversionRates.overallFunnel, 0.1);
  });

  test("recentEvents returns most recent first", () => {
    recordEvent({ name: "landing_visit", timestamp: "2024-01-01T00:00:00Z" });
    recordEvent({ name: "sign_up", timestamp: "2024-01-02T00:00:00Z" });
    const report = getReport();
    assert.equal(report.recentEvents[0]!.name, "sign_up");
    assert.equal(report.recentEvents[1]!.name, "landing_visit");
  });

  test("stores properties on events", () => {
    recordEvent({ name: "membership_added", properties: { is_first: true, kind: "catalog" }, timestamp: new Date().toISOString() });
    const report = getReport();
    assert.deepEqual(report.recentEvents[0]!.properties, { is_first: true, kind: "catalog" });
  });
});

describe("POST /api/analytics", () => {
  beforeEach(() => {
    _clearEvents();
  });

  function makeRequest(body: unknown): Request {
    return new Request("http://localhost/api/analytics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  test("accepts a valid event and returns 201", async () => {
    const res = await POST(makeRequest({ name: "landing_visit", timestamp: "2024-01-01T00:00:00Z" }));
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.ok(typeof body.id === "string");
  });

  test("rejects unknown event names with 400", async () => {
    const res = await POST(makeRequest({ name: "purchase_made" }));
    assert.equal(res.status, 400);
  });

  test("rejects missing name with 400", async () => {
    const res = await POST(makeRequest({ properties: {} }));
    assert.equal(res.status, 400);
  });

  test("rejects invalid JSON with 400", async () => {
    const req = new Request("http://localhost/api/analytics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    const res = await POST(req);
    assert.equal(res.status, 400);
  });

  test("persists the event so GET report reflects it", async () => {
    await POST(makeRequest({ name: "sign_up", properties: { market: "cz" }, timestamp: "2024-01-01T00:00:00Z" }));
    const res = await GET();
    const report = await res.json();
    assert.equal(report.counts.sign_up, 1);
  });
});

describe("GET /api/analytics", () => {
  beforeEach(() => {
    _clearEvents();
  });

  test("returns zero counts when no events recorded", async () => {
    const res = await GET();
    assert.equal(res.status, 200);
    const report = await res.json();
    assert.equal(report.counts.landing_visit, 0);
    assert.equal(report.counts.sign_up, 0);
    assert.equal(report.counts.membership_added, 0);
  });

  test("report contains all expected funnel stages", async () => {
    const res = await GET();
    const report = await res.json();
    const keys = Object.keys(report.counts);
    assert.ok(keys.includes("landing_visit"));
    assert.ok(keys.includes("sign_up"));
    assert.ok(keys.includes("membership_added"));
    assert.ok(keys.includes("mcp_connect"));
    assert.ok(keys.includes("extension_install"));
  });

  test("report includes conversionRates object", async () => {
    const res = await GET();
    const report = await res.json();
    assert.ok("conversionRates" in report);
    assert.ok("visitToSignUp" in report.conversionRates);
    assert.ok("signUpToActivation" in report.conversionRates);
    assert.ok("overallFunnel" in report.conversionRates);
  });

  test("no price data in any event or report field names", async () => {
    const res = await GET();
    const body = await res.text();
    assert.ok(!body.includes("price"), "report must not contain price data");
    assert.ok(!body.includes("amount"), "report must not contain amount data");
    assert.ok(!body.includes("cost"), "report must not contain cost data");
  });
});
