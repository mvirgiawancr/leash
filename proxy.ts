import { NextResponse, type NextRequest } from "next/server";

// Leash has no accounts: each browser gets an anonymous id and connects its own sandbox PayPal wallet.
export function proxy(request: NextRequest) {
  if (request.cookies.get("leash_uid")) return NextResponse.next();

  const uid = `u_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const headers = new Headers(request.headers);
  headers.set("cookie", [request.headers.get("cookie"), `leash_uid=${uid}`].filter(Boolean).join("; "));
  const res = NextResponse.next({ request: { headers } });
  res.cookies.set("leash_uid", uid, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 180 });
  return res;
}

export const config = {
  matcher: ["/((?!_next/|favicon.ico|.*\\.(?:png|jpg|svg|webp|ico)$).*)"],
};
