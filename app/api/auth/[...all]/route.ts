import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/server/auth";

export const dynamic = "force-dynamic";

/** Better Auth endpoints (sign-up, sign-in, verify, reset…). The instance is created once the DB is ready. */
export const { GET, POST } = toNextJsHandler(async (request: Request) => (await getAuth()).handler(request));
