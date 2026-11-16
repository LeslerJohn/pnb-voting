import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["@electric-sql/pglite", "sharp"],
  outputFileTracingIncludes: { "/api/**/*": ["./supabase/migrations/*.sql"] },
  outputFileTracingExcludes: { "/*": ["./.rehearsal/**/*"] },
};

export default config;
