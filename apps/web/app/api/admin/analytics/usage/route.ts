export const dynamic = "force-dynamic";

// Proxy to the backend usage-analytics endpoint (#333) for the leaderboard (#334).
// ADMIN_SECRET is server-side only (no NEXT_PUBLIC_) so it never reaches the
// browser. Forwards all query params (country, fromDay, toDay, channel, programId).

const BACKEND = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8787";

function adminHeaders(): Record<string, string> {
  const secret = process.env.ADMIN_SECRET;
  return {
    "Content-Type": "application/json",
    ...(secret ? { "x-admin-secret": secret } : {}),
  };
}

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const qs = searchParams.toString();
  const url = `${BACKEND}/admin/analytics/usage${qs ? `?${qs}` : ""}`;
  const res = await fetch(url, { headers: adminHeaders() });
  const data = await res.json().catch(() => ({ error: "bad_gateway" }));
  return Response.json(data, { status: res.status });
}
