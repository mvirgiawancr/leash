import { NextResponse } from "next/server";
import { executePurchase } from "@/lib/agent";
import { addTape, getErrand, getMandate, getWallet, updateErrand } from "@/lib/db";
import { userId } from "@/lib/session";

// The human signature: the user approves a purchase the agent held above the ask-above limit.
export async function POST(_req: Request, ctx: RouteContext<"/api/errands/[id]/approve">) {
  const { id } = await ctx.params;
  const uid = await userId();
  const [found, wallet, mandate] = await Promise.all([getErrand(uid, id), getWallet(uid), getMandate(uid)]);
  if (!found || !wallet || !mandate) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { errand } = found;
  if (errand.status !== "needs_you" || !errand.approval) return NextResponse.json({ error: "Nothing to approve." }, { status: 409 });

  const a = errand.approval;
  await addTape(id, { kind: "approve", detail: "signed by you", amount: -a.amount });
  try {
    const r = await executePurchase({
      userId: uid,
      errandId: id,
      mandate,
      wallet,
      item: { productId: a.productId, title: a.title, retailer: a.retailer, price: a.amount },
    });
    if (!r.ok) {
      await updateErrand(id, { status: "declined", approval: null, reply: [...errand.reply, `You signed, but it no longer fits: ${r.why}`] });
    } else {
      await updateErrand(id, { reply: [...errand.reply, `You signed for it, so I bought it: ${a.title} from ${a.retailer}.`] });
    }
  } catch (e) {
    console.error(e);
    await addTape(id, { kind: "error", detail: "PayPal charge failed" });
    return NextResponse.json({ error: "PayPal didn’t accept the charge.", errand: (await getErrand(uid, id))!.errand }, { status: 502 });
  }
  const [after, m] = await Promise.all([getErrand(uid, id), getMandate(uid)]);
  return NextResponse.json({ errand: after!.errand, mandate: m });
}
