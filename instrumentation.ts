/** Starts the background job loop once per Node server process (not on the edge runtime). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME) return; // serverless: /api/cron instead
  const { startWorker } = await import("./src/server/worker");
  startWorker();
}
