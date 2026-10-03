import { NextResponse } from "next/server";
import { draftMandate } from "@/lib/mandate";

export async function POST(req: Request) {
  const { text } = (await req.json()) as { text?: string };
  if (!text || text.trim().length < 8) return NextResponse.json({ error: "Tell Leash a little more." }, { status: 400 });
  try {
    return NextResponse.json({ draft: await draftMandate(text.slice(0, 1200)) });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Couldn’t read that. Try again in a moment." }, { status: 502 });
  }
}
