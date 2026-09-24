import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { PAGES_INDEX_HTML } from "@/lib/pages-index-html";

/**
 * Proxy Next 16 (ex-middleware.ts) :
 *  - en-têtes de sécurité sur toutes les réponses ;
 *  - GET / sert docs/index.html octet à octet (parité 100 % GitHub Pages).
 */
export default function proxy(request: NextRequest) {
  const url = request.nextUrl;

  if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    return new NextResponse(PAGES_INDEX_HTML, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "X-Frame-Options": "SAMEORIGIN",
        "Permissions-Policy": "camera=(), microphone=()",
        "Cache-Control": "no-cache",
      },
    });
  }

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
