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
      {
        // Without this every photo was re-checked on every visit (max-age=0),
        // on a diner's phone over restaurant wifi. A week, not `immutable`: the
        // names are the dish's, so a better photo can land under the same one.
        source: "/dishes/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=604800" }],
      },
      {
        source: "/site/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=604800" }],
      },
    ];
  },
};

export default nextConfig;
