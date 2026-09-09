import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle (`.next/standalone`) with only the
  // traced runtime dependencies. Used by `frontend/Dockerfile` to keep the
  // demo image small (~70 MB vs ~1 GB with full node_modules). No effect on
  // `next dev` / `next start`; it is purely an additional build output.
  output: "standalone",
};

export default nextConfig;
