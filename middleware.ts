import { jwtVerify } from "jose";
import { NextResponse, type NextRequest } from "next/server";

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET!);
const SESSION_COOKIE = "wa_session";

const protectedPaths = [
  "/dashboard",
  "/inbox",
  "/numbers",
  "/contacts",
  "/templates",
  "/campaigns",
  "/automation",
  "/analytics",
  "/billing",
  "/settings",
  "/crm",
  "/appointments",
  "/ads",
  "/segments",
  "/catalog",
  "/admin",
];

const authPaths = ["/login", "/register", "/forgot-password"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isProtected = protectedPaths.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
  const isAuthPath = authPaths.some((p) => pathname.startsWith(p));

  if (!isProtected && !isAuthPath) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  let isAuthenticated = false;

  if (token) {
    try {
      await jwtVerify(token, JWT_SECRET);
      isAuthenticated = true;
    } catch {}
  }

  if (isProtected && !isAuthenticated) {
    // Dev-only auto-login: skip the /login screen and land directly on the
    // requested page using the seeded test user. Enable with DEV_AUTO_LOGIN=true.
    if (process.env.NODE_ENV !== "production" && process.env.DEV_AUTO_LOGIN === "true") {
      const devUrl = new URL("/api/auth/dev-login", request.url);
      devUrl.searchParams.set("from", pathname + request.nextUrl.search);
      return NextResponse.redirect(devUrl);
    }

    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (isAuthPath && isAuthenticated) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
