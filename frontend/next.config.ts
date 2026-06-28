import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the native better-sqlite3 binding out of the bundler (Node runtime only).
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
