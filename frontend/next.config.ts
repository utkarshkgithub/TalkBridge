import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  experimental: {
    optimizePackageImports: ["react-icons/lu", "react-icons/si"],
  },
  partialPrefetching: true,
};

export default nextConfig;
