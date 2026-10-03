import { NextResponse } from "next/server";
import { z } from "zod";
import { getWallet, signMandate } from "@/lib/db";
import { userId } from "@/lib/session";

const body = z.object({
  purpose: z.string().min(3).max(120),
  covers: z.array(z.string().max(80)).max(8),
  excludes: z.array(z.string().max(80)).max(6),
  monthlyBudget: z.number().positive().max(5000),
  askAbove: z.number().min(0),
  expires: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function POST(req: Request) {
  const uid = await userId();
  if (!(await getWallet(uid))) return NextResponse.json({ error: "Connect a PayPal wallet first." }, { status: 400 });
  const parsed = body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Check the mandate fields." }, { status: 400 });
  const m = parsed.data;
  await signMandate(uid, { ...m, askAbove: Math.min(m.askAbove, m.monthlyBudget) });
  return NextResponse.json({ ok: true });
}
