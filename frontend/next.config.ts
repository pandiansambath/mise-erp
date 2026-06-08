import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lean container build (.next/standalone/server.js) for App Runner.
  output: "standalone",
};

export default nextConfig;
