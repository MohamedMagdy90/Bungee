import createMiddleware from "next-intl/middleware";
import type { NextRequest } from "next/server";
import { routing } from "@/i18n/routing";

const intl = createMiddleware(routing);

/**
 * Self-hosted behind nginx, Next's standalone server takes its own bind address (localhost:3000) as the request
 * origin, so the locale redirects (/ -> /en) would send visitors there. Put redirects back on the public host.
 */
export default function middleware(request: NextRequest) {
  const response = intl(request);
  const location = response.headers.get("location");
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host"))?.split(",")[0].trim();
  if (!location || !host) return response;
  const target = new URL(location, request.url);
  if (target.host !== request.nextUrl.host || target.host === host) return response;
  const proto = (request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "")).split(",")[0];
  // Rebuild from scratch: assigning .host alone keeps the internal :3000 port.
  const fixed = new URL(`${target.pathname}${target.search}${target.hash}`, `${proto.trim()}://${host}`);
  response.headers.set("location", fixed.toString());
  return response;
}

export const config = {
  // Everything except API routes, Next internals and files with an extension.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
