import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

const SESSION_COOKIE = "inv_session";

/**
 * First gate: anything that is not the login page needs a valid session cookie.
 * This is a cheap signature check only — pages and actions still re-verify the
 * user against storage via requireUser()/requireUserAction().
 */
export default async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const valid = token ? await isValid(token) : false;

  // The login screen always renders.
  //
  // Bouncing an apparently-signed-in visitor away from here would be decided on
  // the signature alone, and the signature can outlive the account it names -
  // a deleted or deactivated user, or a database that has been reloaded. The
  // page itself would then send them straight back, and the two would argue
  // until the browser gave up with ERR_TOO_MANY_REDIRECTS. Whether a session is
  // genuinely usable needs the database, so that call belongs to the page.
  if (pathname === "/login") return NextResponse.next();

  if (!valid) {
    const url = new URL("/login", request.url);
    if (pathname !== "/") url.searchParams.set("next", `${pathname}${search}`);
    const response = NextResponse.redirect(url);
    if (token) response.cookies.delete(SESSION_COOKIE);
    return response;
  }

  return NextResponse.next();
}

async function isValid(token: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) return false;
  try {
    await jwtVerify(token, new TextEncoder().encode(secret), { algorithms: ["HS256"] });
    return true;
  } catch {
    return false;
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
