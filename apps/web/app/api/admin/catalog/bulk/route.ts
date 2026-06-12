export const dynamic = "force-dynamic";

// Proxy bulk-create requests to the backend admin catalog endpoint.
// Each row in the CSV becomes a separate POST /admin/catalog call.
// The client sends an array of CatalogEntryInput objects; we fan them out
// and return per-row results so the UI can show partial success.

const BACKEND = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8787";

function adminHeaders() {
  const secret = process.env.ADMIN_SECRET;
  return {
    "Content-Type": "application/json",
    ...(secret ? { "x-admin-secret": secret } : {}),
  };
}

interface BulkRow {
  programId: string;
  [key: string]: unknown;
}

interface RowResult {
  programId: string;
  ok: boolean;
  error?: string;
}

export async function POST(request: Request) {
  let rows: BulkRow[];
  try {
    rows = await request.json() as BulkRow[];
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return Response.json({ error: "rows must be a non-empty array" }, { status: 400 });
  }

  const results: RowResult[] = await Promise.all(
    rows.map(async (row) => {
      try {
        const res = await fetch(`${BACKEND}/admin/catalog`, {
          method: "POST",
          headers: adminHeaders(),
          body: JSON.stringify(row),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({})) as { error?: string };
          return { programId: row.programId, ok: false, error: data.error ?? `HTTP ${res.status}` };
        }
        return { programId: row.programId, ok: true };
      } catch (err) {
        return { programId: row.programId, ok: false, error: String(err) };
      }
    }),
  );

  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.length - succeeded;

  return Response.json({ results, succeeded, failed }, { status: 207 });
}
