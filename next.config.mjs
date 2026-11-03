import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Self-contained server bundle for the Docker image on DigitalOcean App Platform.
  output: "standalone",
  poweredByHeader: false,
  allowedDevOrigins: ["*.preview.same-app.com"],
  // PGlite ships WASM + data files; keep it (and pg) out of the bundler.
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  // Migrations are read from disk at runtime, and PGlite loads its WASM from its dist folder: ship both.
  outputFileTracingIncludes: {
    "/*": ["./drizzle/**/*", "./node_modules/@electric-sql/pglite/dist/**/*"],
    "/**": ["./drizzle/**/*", "./node_modules/@electric-sql/pglite/dist/**/*"],
  },
  // Netlify preview builds run the sample database in memory (see src/server/db/index.ts).
  env: { BF_DEMO_DB: process.env.NETLIFY === "true" ? "1" : "0" },
  images: {
    // Media variants are produced at upload time and served from Spaces CDN.
    unoptimized: true,
  },
  async headers() {
    return [
      {
        source: "/fonts/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        source: "/media/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=86400" }],
      },
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
