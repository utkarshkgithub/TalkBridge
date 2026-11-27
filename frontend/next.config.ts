import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  experimental: {
    optimizePackageImports: ["react-icons/lu", "react-icons/si"],
  },
  partialPrefetching: true,
  async headers() {
    return [
      {
        source:
          "/:path(api|dashboard|reviews|insights|workflow|connections|login)/:rest*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default nextConfig;
