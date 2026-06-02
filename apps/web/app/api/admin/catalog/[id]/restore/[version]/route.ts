export const dynamic = "force-dynamic";

const BACKEND = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8787";

function adminHeaders() {
  const secret = process.env.ADMIN_SECRET;
  return {
    "Content-Type": "application/json",
    ...(secret ? { "x-admin-secret": secret } : {}),
  };
}

export async function POST(
  _request: Request,
  { params }: { params: { id: string; version: string } },
) {
  const res = await fetch(`${BACKEND}/admin/catalog/${params.id}/restore/${params.version}`, {
    method: "POST",
    headers: adminHeaders(),
  });
  const data = await res.json();
  return Response.json(data, { status: res.status });
}
