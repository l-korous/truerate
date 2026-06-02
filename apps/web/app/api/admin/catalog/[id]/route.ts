export const dynamic = "force-dynamic";

const BACKEND = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8787";

function adminHeaders() {
  const secret = process.env.ADMIN_SECRET;
  return {
    "Content-Type": "application/json",
    ...(secret ? { "x-admin-secret": secret } : {}),
  };
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const res = await fetch(`${BACKEND}/admin/catalog/${params.id}`, { headers: adminHeaders() });
  const data = await res.json();
  return Response.json(data, { status: res.status });
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const body = await request.json();
  const res = await fetch(`${BACKEND}/admin/catalog/${params.id}`, {
    method: "PUT",
    headers: adminHeaders(),
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return Response.json(data, { status: res.status });
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const res = await fetch(`${BACKEND}/admin/catalog/${params.id}`, {
    method: "DELETE",
    headers: adminHeaders(),
  });
  if (res.status === 204) return new Response(null, { status: 204 });
  const data = await res.json();
  return Response.json(data, { status: res.status });
}
