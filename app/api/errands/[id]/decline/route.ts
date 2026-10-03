import { NextResponse } from "next/server";
import { addTape, getErrand, getMandate, updateErrand } from "@/lib/db";
import { userId } from "@/lib/session";

export async function POST(_req: Request, ctx: RouteContext<"/api/errands/[id]/decline">) {
  const { id } = await ctx.params;
  const uid = await userId();
  const found = await getErrand(uid, id);
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (found.errand.status !== "needs_you") return NextResponse.json({ error: "Nothing to decline." }, { status: 409 });

  await addTape(id, { kind: "decline", detail: "you said no — nothing charged" });
  await updateErrand(id, { status: "declined", approval: null, reply: [...found.errand.reply, "You declined, so I left it. Nothing was charged."] });
  const [after, m] = await Promise.all([getErrand(uid, id), getMandate(uid)]);
  return NextResponse.json({ errand: after!.errand, mandate: m });
}
