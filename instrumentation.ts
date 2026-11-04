/** Starts the background job loop once per Node server process (not on the edge runtime). */
export async function register() {
  // Keep the import INSIDE this block: Next only drops it from the edge bundle when it sits under
  // `NEXT_RUNTIME === "nodejs"` (an early return doesn't count, and pg would then break the edge build).
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME) return; // serverless: /api/cron instead
    const { startWorker } = await import("./src/server/worker");
    startWorker();
  }
}
