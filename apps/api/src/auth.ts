import { sign, verify } from "hono/jwt";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";

// Stateless JWT auth — no session store, which keeps us off Redis. The same
// secret signs tokens in the API and verifies them in the MCP server. For
// production, swap this for Microsoft Entra External ID (managed identity
// provider) and validate its tokens here instead; the middleware shape stays
// the same.

function secret(): string {
  const s = process.env.TRUERATE_JWT_SECRET;
  if (!s) throw new Error("TRUERATE_JWT_SECRET is not set.");
  return s;
}

export interface TokenPayload {
  sub: string; // user id
  email: string;
  exp: number;
}

export async function issueToken(userId: string, email: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30; // 30 days
  return sign({ sub: userId, email, exp }, secret(), "HS256");
}

export async function verifyToken(token: string): Promise<TokenPayload> {
  return (await verify(token, secret(), "HS256")) as unknown as TokenPayload;
}

/** Requires a valid bearer token; sets `userId` on the context. */
export const requireAuth = createMiddleware<{
  Variables: { userId: string; email: string };
}>(async (c, next) => {
  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) {
    throw new HTTPException(401, { message: "Missing bearer token" });
  }
  try {
    const payload = await verifyToken(header.slice(7));
    c.set("userId", payload.sub);
    c.set("email", payload.email);
  } catch {
    throw new HTTPException(401, { message: "Invalid or expired token" });
  }
  await next();
});
