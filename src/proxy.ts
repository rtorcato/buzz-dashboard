import { type NextRequest, NextResponse } from "next/server";
import { ownerFrom, readsNeedSignIn, SESSION_COOKIE } from "./lib/auth";

// REQUIRE_SIGN_IN_FOR_READS (#115): one gate in front of every page and API
// route, so a new view can't forget it. Off by default.

// Reachable signed out: the sign-in page and its API, the liveness check,
// and OTLP ingest, which has its own bearer token (#42).
const PUBLIC = /^\/(sign-in$|api\/auth\/|api\/health$|otlp\/)/;

export function proxy(request: NextRequest) {
  if (!readsNeedSignIn()) return NextResponse.next();
  const { pathname, search } = request.nextUrl;
  if (PUBLIC.test(pathname)) return NextResponse.next();
  const owner = ownerFrom(request.cookies.get(SESSION_COOKIE)?.value, (name) =>
    request.headers.get(name),
  );
  if (owner) return NextResponse.next();
  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "sign-in required" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  const url = new URL("/sign-in", request.url);
  url.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(url);
}

export const config = {
  // Static assets carry no hive data.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
