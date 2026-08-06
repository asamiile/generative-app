import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // lib/backendFetch.ts uses undici's Agent for a longer per-request timeout.
  // webpack fails to bundle undici's internal mock subsystem (it references
  // node:console) with UnhandledSchemeError, so load it natively via Node's
  // require instead of bundling it.
  serverExternalPackages: ["undici"],
};

export default nextConfig;
