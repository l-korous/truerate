export const dynamic = "force-dynamic";

import { recordEvent, getReport } from "../../../lib/analytics-store";
import type { FunnelEventName } from "../../../lib/analytics";

const VALID_EVENTS = new Set<FunnelEventName>([
  "landing_visit",
  "sign_up",
  "membership_added",
  "mcp_connect",
  "extension_install",
]);

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null || !("name" in body)) {
    return Response.json({ error: "Missing event name" }, { status: 400 });
  }

  const { name, properties, timestamp } = body as Record<string, unknown>;

  if (typeof name !== "string" || !VALID_EVENTS.has(name as FunnelEventName)) {
    return Response.json({ error: "Unknown event name" }, { status: 400 });
  }

  const safeProps =
    properties && typeof properties === "object" && !Array.isArray(properties)
      ? (properties as Record<string, string | boolean | number>)
      : undefined;

  const event = recordEvent({
    name: name as FunnelEventName,
    properties: safeProps,
    timestamp: typeof timestamp === "string" ? timestamp : new Date().toISOString(),
  });

  return Response.json({ ok: true, id: event.id }, { status: 201 });
}

export function GET() {
  return Response.json(getReport());
}
