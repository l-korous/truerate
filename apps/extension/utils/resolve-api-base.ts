/**
 * Resolves the API base URL for build-time injection.
 *
 * Priority: API_BASE_URL shell/env var > mode-based fallback.
 * Production without an explicit var uses https://api.invalid (an obviously
 * broken placeholder) so localhost is never silently baked into a prod artifact.
 */
export function resolveApiBase(mode: string): string {
  const apiBase = process.env.API_BASE_URL;
  if (apiBase) return apiBase;
  return mode === "production" ? "https://api.invalid" : "http://localhost:8787";
}
