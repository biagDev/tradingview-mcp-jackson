/** @type {import('next').NextConfig} */
const nextConfig = {
  // better-sqlite3 is a native module; keep it external so Next doesn't try to bundle it.
  experimental: {
    serverComponentsExternalPackages: ['better-sqlite3'],
  },
  reactStrictMode: true,
};

export default nextConfig;
