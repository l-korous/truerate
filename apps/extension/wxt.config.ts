import { defineConfig } from "wxt";
import { resolveApiBase } from "./utils/resolve-api-base.js";

// WXT generates a Manifest V3 extension. We scope host permissions to
// Booking.com only (the MVP surface) plus the TrueRate API origin. Widen the
// matches list as more OTAs are supported.

export default defineConfig({
  // manifest can be a function so host_permissions tracks the resolved API origin.
  manifest: ({ mode }) => {
    const apiBase = resolveApiBase(mode);
    const apiOrigin = new URL(apiBase).origin;
    return {
      name: "__MSG_extName__",
      description: "__MSG_extDescription__",
      default_locale: "en",
      permissions: ["storage", "activeTab"],
      host_permissions: ["https://*.booking.com/*", "https://*.expedia.com/*", `${apiOrigin}/*`],
      action: { default_popup: "popup.html", default_title: "TrueRate" },
    };
  },
  // API_BASE_URL is injected at build time. Set it via:
  //   - .env (local dev, see .env.example)
  //   - Shell env var for CI/production builds
  vite: ({ mode }) => ({
    define: {
      __API_BASE__: JSON.stringify(resolveApiBase(mode)),
    },
  }),
});
