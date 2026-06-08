import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ADMIN_COOKIE, verifyAdminToken } from "@/lib/admin-auth";

// Gate the admin console. The /api/admin/* proxies inject ADMIN_SECRET
// server-side, so without this anyone could read admin data via the web app.
// Require a valid admin session cookie; the login page + login API are exempt.
//
// Fail-closed: if ADMIN_SECRET is unset (admin disabled) or the cookie is
// missing/invalid, admin pages redirect to /admin/login and admin APIs return
// 401 — data is never exposed.

export const config = { matcher: ["/admin/:path*", "/api/admin/:path*"] };

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;

  // Allow the sign-in surfaces through unauthenticated.
  if (pathname === "/admin/login" || pathname === "/api/admin/login") {
    return NextResponse.next();
  }

  const secret = process.env.ADMIN_SECRET;
  const token = req.cookies.get(ADMIN_COOKIE)?.value;
  const authed = !!secret && (await verifyAdminToken(token, secret));
  if (authed) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "admin_auth_required" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/admin/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}
