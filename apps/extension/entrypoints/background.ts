import { getToken, matchPage } from "../utils/api";
import { isTrMessage } from "../utils/messages";

// The background worker is the only place that holds the token; content scripts
// post a page context and get back the benefit matches.
//
// The listener is async: returning a Promise is how webextension messaging
// delivers an async response (no `sendResponse` needed), and a Promise return
// satisfies wxt's `OnMessageListener` type. Returning `undefined` for messages
// we don't recognise leaves them for any other listener.

export default defineBackground(() => {
  browser.runtime.onMessage.addListener(async (rawMsg) => {
    if (!isTrMessage(rawMsg)) return;
    if (rawMsg.type === "TR_MATCH") {
      try {
        return { ok: true as const, result: await matchPage(rawMsg.context) };
      } catch (e) {
        return { ok: false as const, error: (e as Error).message };
      }
    }
    // rawMsg.type === "TR_AUTH_STATUS"
    return { signedIn: Boolean(await getToken()) };
  });
});
