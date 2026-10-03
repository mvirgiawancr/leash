import { NextResponse } from "next/server";
import { addTape, getErrand, getMandate, updateErrand } from "@/lib/db";
import { userId } from "@/lib/session";

export async function POST(_req: Request, ctx: RouteContext<"/api/errands/[id]/decline">) {
  const { id } = await ctx.params;
  const uid = await userId();
  const found = getErrand(uid, id);
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (found.errand.status !== "needs_you") return NextResponse.json({ error: "Nothing to decline." }, { status: 409 });

  addTape(id, { kind: "decline", detail: "you said no — nothing charged" });
  updateErrand(id, { status: "declined", approval: null, reply: [...found.errand.reply, "You declined, so I left it. Nothing was charged."] });
  return NextResponse.json({ errand: getErrand(uid, id)!.errand, mandate: getMandate(uid) });
}
