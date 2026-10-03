import { NextResponse } from "next/server";
import { addTape, getErrand, getMandate, getPurchase, markRefunded, updateErrand } from "@/lib/db";
import { refundCapture } from "@/lib/paypal";
import { userId } from "@/lib/session";

// "This isn't what I wanted": refund the buyer through PayPal's agent toolkit (create_refund).
export async function POST(_req: Request, ctx: RouteContext<"/api/purchases/[id]/refund">) {
  const { id } = await ctx.params;
  const uid = await userId();
  const p = getPurchase(uid, id);
  if (!p) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (p.status !== "settled") return NextResponse.json({ error: "Already refunded." }, { status: 409 });

  try {
    const { refundId } = await refundCapture(p.capture_id, `Leash: returning ${p.title}`.slice(0, 255));
    markRefunded(id, refundId);
    addTape(p.errand_id, { kind: "refund", detail: "back to your PayPal", amount: p.amount, ref: `refund ${refundId}` });
    const e = getErrand(uid, p.errand_id)!.errand;
    updateErrand(p.errand_id, {
      status: "refunded",
      receipt: { ...e.receipt!, refund: refundId },
      reply: [...e.reply, `Refunded ${p.title}. The money is back in your PayPal and your budget is restored.`],
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "PayPal didn’t accept the refund." }, { status: 502 });
  }
  return NextResponse.json({ errand: getErrand(uid, p.errand_id)!.errand, mandate: getMandate(uid) });
}
