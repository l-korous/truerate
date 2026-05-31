import type { PageContext, PageMatchResult } from "@truerate/core";

// Shared message protocol between content scripts / popup and the background
// worker. Keeping it as a discriminated union means both sides get the right
// payload and response shape from the message tag alone.

export type TrMessage =
  | { type: "TR_MATCH"; context: PageContext }
  | { type: "TR_AUTH_STATUS" };

export type TrMatchResponse =
  | { ok: true; result: PageMatchResult }
  | { ok: false; error: string };

export type TrAuthStatusResponse = { signedIn: boolean };

export type TrResponseFor<M extends TrMessage> = M extends { type: "TR_MATCH" }
  ? TrMatchResponse
  : M extends { type: "TR_AUTH_STATUS" }
    ? TrAuthStatusResponse
    : never;

export function isTrMessage(m: unknown): m is TrMessage {
  if (typeof m !== "object" || m === null) return false;
  const t = (m as { type?: unknown }).type;
  return t === "TR_MATCH" || t === "TR_AUTH_STATUS";
}

/** Type-safe wrapper around browser.runtime.sendMessage. */
export function sendTrMessage(message: Extract<TrMessage, { type: "TR_MATCH" }>): Promise<TrMatchResponse>;
export function sendTrMessage(message: Extract<TrMessage, { type: "TR_AUTH_STATUS" }>): Promise<TrAuthStatusResponse>;
export function sendTrMessage(message: TrMessage): Promise<TrMatchResponse | TrAuthStatusResponse> {
  return browser.runtime.sendMessage(message) as Promise<TrMatchResponse | TrAuthStatusResponse>;
}
