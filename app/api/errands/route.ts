import { NextResponse } from "next/server";
import { runErrand } from "@/lib/agent";
import { addTape, createErrand, getErrand, getMandate, getWallet, updateErrand } from "@/lib/db";
import { userId } from "@/lib/session";
import type { ErrandEvent } from "@/lib/types";

export const maxDuration = 120;

// Streams the agent's work as NDJSON so the ledger tape prints line by line.
export async function POST(req: Request) {
  const uid = await userId();
  const { ask } = (await req.json()) as { ask?: string };
  const wallet = getWallet(uid);
  const mandate = getMandate(uid);
  if (!wallet || !mandate) return NextResponse.json({ error: "Connect PayPal and sign a mandate first." }, { status: 400 });
  if (!ask || ask.trim().length < 3) return NextResponse.json({ error: "What should Leash get?" }, { status: 400 });

  const errandId = createErrand(uid, mandate.id, ask.trim().slice(0, 400));
  const enc = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: ErrandEvent) => controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
      emit({ type: "start", errand: getErrand(uid, errandId)!.errand });
      try {
        const errand = await runErrand({ userId: uid, errandId, ask: ask.trim(), wallet, emit });
        emit({ type: "done", errand, mandate: getMandate(uid)! });
      } catch (e) {
        console.error(e);
        emit({ type: "tape", line: addTape(errandId, { kind: "error", detail: "agent stopped — nothing was charged after this line" }) });
        updateErrand(errandId, { status: "failed", reply: ["I hit a problem talking to my model provider and stopped. Try again in a minute."] });
        emit({ type: "done", errand: getErrand(uid, errandId)!.errand, mandate: getMandate(uid)! });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
