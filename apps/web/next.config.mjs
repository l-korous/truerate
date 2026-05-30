/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output keeps the Azure Container App image small.
  output: "standalone",
  reactStrictMode: true,
};

export default nextConfig;
