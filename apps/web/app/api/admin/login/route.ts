export const dynamic = "force-dynamic";

import { ADMIN_COOKIE, ADMIN_COOKIE_MAX_AGE, makeAdminToken, timingSafeEqual } from "@/lib/admin-auth";

// POST /api/admin/login — exchange the admin secret for an httpOnly session cookie.
// DELETE — sign out (clear the cookie).
//
// `Secure` is set only in production: in dev/e2e the app is served over http and
// a Secure cookie would be dropped by the browser.

function cookie(value: string, maxAge: number): string {
  const secure = process.env.NODE_ENV === "production" ? " Secure;" : "";
  return `${ADMIN_COOKIE}=${value}; HttpOnly;${secure} SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return Response.json({ error: "admin_disabled" }, { status: 503 });

  const body = (await request.json().catch(() => ({}))) as { secret?: unknown };
  const submitted = typeof body.secret === "string" ? body.secret : "";
  if (!submitted || !timingSafeEqual(submitted, secret)) {
    return Response.json({ error: "invalid_secret" }, { status: 401 });
  }

  const token = await makeAdminToken(secret);
  const res = Response.json({ ok: true });
  res.headers.append("Set-Cookie", cookie(token, ADMIN_COOKIE_MAX_AGE));
  return res;
}

export async function DELETE(): Promise<Response> {
  const res = Response.json({ ok: true });
  res.headers.append("Set-Cookie", cookie("", 0));
  return res;
}
