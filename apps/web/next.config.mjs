/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output keeps the Azure Container App image small.
  output: "standalone",
  reactStrictMode: true,
  typescript: {
    // Production builds use tsconfig.build.json which excludes e2e/ so that
    // next build does not typecheck Playwright specs (which import
    // @truerate/harness). The e2e specs are typechecked by turbo typecheck
    // (dependsOn ^build ensures harness is built first) and by Playwright.
    tsconfigPath: "./tsconfig.build.json",
  },
};

export default nextConfig;
