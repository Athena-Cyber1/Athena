import { NextResponse } from "next/server";

/**
 * Proxy Next 16 (ex-middleware.ts) : ajoute les en-têtes de sécurité
 * sur toutes les réponses (pages + routes API).
 */
export default function proxy() {
  const res = NextResponse.next();
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("X-Frame-Options", "SAMEORIGIN");
  res.headers.set("Permissions-Policy", "camera=(), microphone=()");
  return res;
}

export const config = {
  matcher: "/((?!_next/static|_next/image|favicon.ico).*)",
};
