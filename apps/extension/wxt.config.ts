import { defineConfig } from "wxt";

// WXT generates a Manifest V3 extension. We scope host permissions to
// Booking.com only (the MVP surface) plus the TrueRate API origin. Widen the
// matches list as more OTAs are supported.

export default defineConfig({
  manifest: {
    name: "TrueRate",
    description:
      "See the rates your loyalty memberships actually unlock — right on the search page.",
    permissions: ["storage", "activeTab"],
    host_permissions: ["https://*.booking.com/*", "http://localhost:8787/*"],
    action: { default_popup: "popup.html", default_title: "TrueRate" },
  },
  // The API base is read at build time; override per environment.
  vite: () => ({
    define: {
      __API_BASE__: JSON.stringify(process.env.API_BASE_URL ?? "http://localhost:8787"),
    },
  }),
});
