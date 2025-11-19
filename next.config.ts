import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    domains: [
      "firebasestorage.googleapis.com",
    ],
    unoptimized: false,
  },
};

export default nextConfig;
