import type { NextConfig } from "next";

const securityHeaders = [
  // Merod's own pages may frame each other (Talk's floating window); every other site is still blocked.
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const config: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["pg", "ioredis", "bullmq"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};
export default config;
