import { NextResponse, type NextRequest } from "next/server";
import { saveSetupToken } from "@/lib/db";
import { createSetupToken } from "@/lib/paypal";
import { userId } from "@/lib/session";

export async function POST(req: NextRequest) {
  const uid = await userId();
  // behind a proxy the request origin can be internal; APP_URL pins the public one
  const origin = process.env.APP_URL?.replace(/\/$/, "") || req.nextUrl.origin;
  const { id, approveUrl } = await createSetupToken(origin);
  await saveSetupToken(uid, id);
  return NextResponse.json({ approveUrl });
}
