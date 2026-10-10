import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @minitickets/shared ships TypeScript source (no build step), so Next must compile it too.
  transpilePackages: ["@minitickets/shared"],
};

export default nextConfig;
