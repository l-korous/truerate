import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output keeps the Azure Container App image small.
  output: "standalone",
  reactStrictMode: true,
};

export default withNextIntl(nextConfig);
