export const dynamic = "force-dynamic";

// Proxy to backend admin config endpoints.
// ADMIN_SECRET is server-side only so it never reaches the browser.

const BACKEND = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8787";

function adminHeaders() {
  const secret = process.env.ADMIN_SECRET;
  return {
    "Content-Type": "application/json",
    ...(secret ? { "x-admin-secret": secret } : {}),
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const env = searchParams.get("environment");
  const url = env
    ? `${BACKEND}/admin/config?environment=${encodeURIComponent(env)}`
    : `${BACKEND}/admin/config`;
  const res = await fetch(url, { headers: adminHeaders() });
  const data = await res.json();
  return Response.json(data, { status: res.status });
}

export async function POST(request: Request) {
  const body = await request.json();
  const res = await fetch(`${BACKEND}/admin/config`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return Response.json(data, { status: res.status });
}
