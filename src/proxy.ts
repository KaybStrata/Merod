import { NextResponse, type NextRequest } from "next/server";

/**
 * Logged-out visitors at "/" see the public landing page (the URL stays "/").
 * Signed-in users (session cookie present) get the app Home as before; an expired cookie still
 * falls through to the app layout, which sends them to /login.
 */
export function proxy(request: NextRequest) {
  if (!request.cookies.get("merod_session")?.value) return NextResponse.rewrite(new URL("/welcome", request.url));
  return NextResponse.next();
}

export const config = { matcher: ["/"] };
