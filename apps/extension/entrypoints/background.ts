import { getToken, matchPage } from "../utils/api";
import { isTrMessage } from "../utils/messages";

// The background worker is the only place that holds the token; content scripts
// post a page context and get back the benefit matches.

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!isTrMessage(msg)) return;
    if (msg.type === "TR_MATCH") {
      (async () => {
        try {
          const result = await matchPage(msg.context);
          sendResponse({ ok: true, result });
        } catch (e) {
          sendResponse({ ok: false, error: (e as Error).message });
        }
      })();
      return true;
    }
    if (msg.type === "TR_AUTH_STATUS") {
      getToken().then((t) => sendResponse({ signedIn: Boolean(t) }));
      return true;
    }
  });
});
