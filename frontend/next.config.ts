import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lean container build (.next/standalone/server.js) for App Runner.
  output: "standalone",
  async headers() {
    return [
      {
        // The cinema assets never change in place (new scenes get new names) —
        // cache them hard so repeat visits play everything from disk.
        source: "/experience/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=2592000, immutable" }],
      },
      {
        source: "/chef/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=2592000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
