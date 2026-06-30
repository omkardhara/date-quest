/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Ensure events-cache.json (written by GitHub Actions cron) is bundled
    // into the serverless functions that read it via fs.readFileSync.
    outputFileTracingIncludes: {
      "/api/events":               ["./data/events-cache.json"],
      "/api/cron/refresh-events":  ["./data/events-cache.json"],
    },
  },
};
export default nextConfig;
