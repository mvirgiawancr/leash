import "server-only";
import { generateText, isStepCount, tool, type ModelMessage } from "ai";
import { z } from "zod";
import { searchProducts, type Found } from "./channel3";
import { addTape, getErrand, getMandate, recordPurchase, spentThisMonth, updateErrand } from "./db";
import { withFallback } from "./llm";
import { chargeVault, payRetailer } from "./paypal";
import type { ErrandEvent, ErrandStatus, FoundCard, Mandate, Option, TapeLine, Wallet } from "./types";

type Emit = (e: ErrandEvent) => void;

const money = (n: number) => `$${n.toFixed(2)}`;

/**
 * Charge the buyer's vaulted wallet, settle with the retailer, write it all to the tape.
 * Used by the agent's `purchase` tool and by the human "Approve" button. The budget is re-checked here,
 * so neither the model nor a stale browser tab can overspend the mandate.
 */
export async function executePurchase(args: {
  userId: string;
  errandId: string;
  mandate: Mandate;
  wallet: Wallet;
  item: Pick<Option, "productId" | "title" | "retailer" | "price">;
  emit?: Emit;
}) {
  const { userId, errandId, mandate, wallet, item, emit } = args;
  const tape = (l: Omit<TapeLine, "at">) => {
    const line = addTape(errandId, l); // always persist, even when nobody is streaming (the Approve button)
    emit?.({ type: "tape", line });
  };

  const remaining = mandate.monthlyBudget - spentThisMonth(mandate.id);
  if (item.price > remaining + 1e-9) {
    tape({ kind: "refuse", detail: `over budget, ${money(remaining)} left` });
    return { ok: false as const, why: `Only ${money(remaining)} left this month.` };
  }

  const { orderId, captureId } = await chargeVault(wallet.vaultId, item.price, `Leash · ${item.title} (${item.retailer})`, wallet.shipTo);
  tape({ kind: "charge", detail: "PayPal wallet (vault)", amount: -item.price, ref: `order ${orderId}` });

  let payoutBatch: string | undefined;
  try {
    payoutBatch = await payRetailer(item.price, `Settlement: ${item.title} via ${item.retailer}`);
    tape({ kind: "payout", detail: item.retailer, amount: item.price, ref: `batch ${payoutBatch}` });
  } catch (e) {
    tape({ kind: "error", detail: `payout to ${item.retailer} failed — will retry` });
    console.error(e);
  }

  recordPurchase({
    errandId,
    mandateId: mandate.id,
    userId,
    productId: item.productId,
    title: item.title,
    retailer: item.retailer,
    amount: item.price,
    orderId,
    captureId,
    payoutBatch,
  });
  updateErrand(errandId, { status: "bought", receipt: { order: orderId, capture: captureId, payout: payoutBatch }, approval: null });
  emit?.({ type: "status", status: "bought" });
  return { ok: true as const, orderId, captureId, payoutBatch };
}

function systemPrompt(m: Mandate) {
  const remaining = m.monthlyBudget - m.spent;
  return `You are Leash, a careful shopping agent. You spend the user's money ONLY inside the mandate they signed.

MANDATE
- Purpose: ${m.purpose}
- Covers: ${m.covers.join("; ") || "(see purpose)"}
- Excludes: ${m.excludes.join("; ") || "(nothing listed)"}
- Monthly budget: ${money(m.monthlyBudget)} · spent this month: ${money(m.spent)} · remaining: ${money(remaining)}
- You may buy on your own up to ${money(m.askAbove)} per item; above that the user must sign.
- Valid until: ${m.expires}. Today: ${new Date().toISOString().slice(0, 10)}.

HOW TO WORK
1. If the request is outside the mandate's purpose or explicitly excluded, call decline_request and stop. Do not search.
2. search_products, at most 2 searches, never the same query twice. Don't set max_price_usd unless the user gave a price; results over the remaining budget come back marked over_budget.
3. Results marked price_looks_off are priced far below similar items (listing errors, accessories, knock-offs). Prefer not to pick them; if you do, it will be held for the user. Also distrust any price that is implausible for what the title claims.
   Compare on value for THIS user's stated need. Call shortlist with 2-3 options, one-line "why" each, and your pick.
4. If the user named a specific product or model, pick THAT product, choosing the cheapest trustworthy NEW listing of that exact model (listings with a condition field are used/refurbished; only pick one if the user asked for it, and it will be held for them). Never substitute a different product to stay under the ask-first line or the budget: being held for the user's signature is normal and expected. If the named product is over budget or not found, still shortlist what you found (so the user sees the real prices), say so, and stop without buying.
5. Call check_mandate for the pick.
   - ok → call purchase.
   - held (needs signature) → stop. Do NOT call purchase.
   - over budget → for open requests pick a cheaper option from the results; for a named product, stop.
6. Buy at most one item per request.

FINAL MESSAGE
Plain text, 1–3 short paragraphs, no markdown, no lists, no tables (the app shows the options). Say what you did and why, in the first person, speaking to the user as "you" (never "the user"). Never mention product IDs or internal field names (price_looks_off, over_budget, condition), in the final message or in shortlist "why" lines. Only state facts that came from tool results. Never invent prices or features.`;
}

export async function runErrand(args: { userId: string; errandId: string; ask: string; wallet: Wallet; emit: Emit }) {
  const { userId, errandId, ask, wallet, emit } = args;
  const mandate = getMandate(userId);
  if (!mandate) throw new Error("No active mandate");

  const tape = (l: Omit<TapeLine, "at">) => emit({ type: "tape", line: addTape(errandId, l) });
  const found = new Map<string, Found>();
  const cleared = new Set<string>();
  const suspicious = new Set<string>();
  const queries = new Set<string>();
  let shortlisted = false;
  const sheet: FoundCard[] = [];
  let searches = 0;
  const run = { outcome: null as ErrandStatus | null };

  const tools = {
    decline_request: tool({
      description: "Decline a request that is outside the mandate. Call this instead of searching.",
      inputSchema: z.object({ reason: z.string().describe("short reason, e.g. 'furniture is not a computer peripheral'") }),
      execute: async ({ reason }) => {
        tape({ kind: "refuse", detail: `outside mandate: ${reason}` });
        run.outcome = "refused";
        return { declined: true };
      },
    }),

    search_products: tool({
      description: "Search real, in-stock products across online retailers.",
      inputSchema: z.object({
        query: z.string(),
        max_price_usd: z.number().optional(),
      }),
      execute: async ({ query, max_price_usd }) => {
        const key = query.trim().toLowerCase();
        if (queries.has(key)) return { error: "You already ran this search. Decide with those results." };
        if (++searches > 2) return { error: "Search limit reached. Decide with what you have." };
        queries.add(key);
        const remaining = mandate.monthlyBudget - spentThisMonth(mandate.id);
        const items = await searchProducts(query, max_price_usd);
        items.forEach((i) => found.set(i.productId, i));
        // Too-good-to-be-true prices (listing errors, accessories posing as the product) never auto-buy.
        const sorted = items.map((i) => i.price).sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
        if (items.length >= 3) items.filter((i) => i.price < median * 0.35).forEach((i) => suspicious.add(i.productId));
        const flagged = items.filter((i) => suspicious.has(i.productId)).length;
        // contact sheet: every listing the agent looked at, across searches (deduped, capped)
        for (const i of items) {
          if (sheet.length >= 8 || sheet.some((c) => c.productId === i.productId)) continue;
          sheet.push({
            productId: i.productId,
            title: i.title,
            retailer: i.retailer,
            price: i.price,
            image: i.image,
            ...(i.condition && i.condition !== "new" ? { condition: i.condition } : {}),
            ...(suspicious.has(i.productId) ? { oddPrice: true } : {}),
          });
        }
        updateErrand(errandId, { found: sheet });
        emit({ type: "found", found: [...sheet] });
        tape({
          kind: "search",
          detail: `${query}${max_price_usd ? ` ≤ ${money(max_price_usd)}` : ""} · ${items.length} found${flagged ? ` · ${flagged} odd price` : ""}`,
        });
        return items.map((i) => ({
          product_id: i.productId,
          title: i.title.slice(0, 90),
          price_usd: i.price,
          retailer: i.retailer,
          ...(i.rating ? { rating: i.rating } : {}),
          features: i.features.slice(0, 2).map((f) => f.slice(0, 60)),
          ...(suspicious.has(i.productId) ? { price_looks_off: true } : {}),
          ...(i.condition && i.condition !== "new" ? { condition: i.condition } : {}),
          ...(i.price > remaining ? { over_budget: true } : {}),
        }));
      },
    }),

    shortlist: tool({
      description: "Record the 2-3 options you compared and which one you pick.",
      inputSchema: z.object({
        options: z
          .array(
            z.object({
              product_id: z.string(),
              why: z.string().describe("one short line"),
              price_plausible: z.boolean().describe("false if the price is implausibly low for what the title claims"),
            }),
          )
          .min(1)
          .max(3),
        pick: z.string().describe("product_id of your pick"),
      }),
      execute: async ({ options, pick }) => {
        options.filter((o) => !o.price_plausible).forEach((o) => suspicious.add(o.product_id));
        shortlisted = true;
        // freeze the contact-sheet notes against the budget as it stood when the agent decided
        const left = mandate.monthlyBudget - spentThisMonth(mandate.id);
        for (const c of sheet) {
          c.note =
            c.condition ??
            (c.oddPrice || suspicious.has(c.productId)
              ? "odd price"
              : c.price > left
                ? "over budget"
                : c.price > mandate.askAbove
                  ? `over $${Math.round(mandate.askAbove)}`
                  : undefined);
        }
        updateErrand(errandId, { found: sheet });
        emit({ type: "found", found: sheet.map((c) => ({ ...c })) });
        const list: Option[] = options
          .map(({ product_id, why }) => {
            const f = found.get(product_id);
            if (!f) return null;
            const { features: _features, ...o } = f;
            return { ...o, why: plainWhy(why), picked: product_id === pick };
          })
          .filter((o): o is NonNullable<typeof o> => o !== null);
        if (!list.length) return { error: "Unknown product ids. Use product_id values from search results." };
        updateErrand(errandId, { options: list });
        emit({ type: "options", options: list });
        const p = found.get(pick);
        if (p) tape({ kind: "pick", detail: `${p.title} · ${p.retailer}` });
        return { recorded: list.length };
      },
    }),

    check_mandate: tool({
      description: "Check a product against the mandate. Always call before purchase.",
      inputSchema: z.object({ product_id: z.string() }),
      execute: async ({ product_id }) => {
        const p = found.get(product_id);
        if (!p) return { error: "Unknown product_id." };
        if (!shortlisted) return { error: "Call shortlist first so the user can see what you compared." };
        const remaining = mandate.monthlyBudget - spentThisMonth(mandate.id);
        if (p.price > remaining) {
          tape({ kind: "refuse", detail: `${money(p.price)} is over the ${money(remaining)} left` });
          return { ok: false, reason: "over_budget", remaining };
        }
        // Why a human has to sign, most important first. Used / refurbished never auto-buys.
        const reason =
          p.price > mandate.askAbove
            ? "above_limit"
            : p.condition && p.condition !== "new"
              ? "not_new"
              : suspicious.has(product_id)
                ? "odd_price"
                : null;
        if (reason) {
          updateErrand(errandId, {
            status: "needs_you",
            approval: { productId: p.productId, title: p.title, retailer: p.retailer, amount: p.price, image: p.image, reason },
          });
          const why = {
            above_limit: `above ${money(mandate.askAbove)}`,
            not_new: `${p.condition} listing`,
            odd_price: "price looks too low to trust",
          }[reason];
          tape({ kind: "hold", detail: `${why}, waiting for you`, amount: -p.price });
          emit({ type: "status", status: "needs_you", approval: getErrand(userId, errandId)?.errand.approval });
          run.outcome = "needs_you";
          return { ok: false, reason: "held_for_signature", note: "Held for the user's signature. Do not call purchase. Write your final message." };
        }
        cleared.add(product_id);
        tape({ kind: "check", detail: `within mandate, ${money(remaining - p.price)} left after` });
        return { ok: true, remaining_after: +(remaining - p.price).toFixed(2) };
      },
    }),

    purchase: tool({
      description: "Buy the product with the user's saved PayPal wallet. Only after check_mandate returned ok.",
      inputSchema: z.object({ product_id: z.string() }),
      execute: async ({ product_id }) => {
        // hard guards: the model can't talk its way past these
        if (run.outcome === "bought") return { error: "Already bought one item for this request." };
        if (!cleared.has(product_id)) return { error: "Not cleared. Call check_mandate first; held items need the user." };
        const p = found.get(product_id)!;
        try {
          const r = await executePurchase({ userId, errandId, mandate, wallet, item: p, emit });
          if (r.ok) run.outcome = "bought";
          return r;
        } catch (e) {
          tape({ kind: "error", detail: "PayPal charge failed" });
          return { error: String((e as Error).message) };
        }
      },
    }),
  };

  const messages: ModelMessage[] = [{ role: "user", content: ask }];
  let finalText = "";
  let modelName = "";
  let nudges = 0;

  try {
    for (let step = 0; step < 10; step++) {
      const { value: res, slot } = await withFallback(({ model }) =>
        generateText({ model, system: systemPrompt(mandate), messages, tools, stopWhen: isStepCount(1), maxRetries: 0 }),
      );
      modelName = slot.name;
      messages.push(...res.responseMessages);
      if (!res.toolCalls.length) {
        // gpt-oss sometimes stops with an empty turn mid-task; nudge it on instead of giving up
        if (!res.text.trim() && nudges < 2) {
          nudges++;
          messages.push({
            role: "user",
            content: run.outcome
              ? "Write your final message to me now."
              : "Continue: shortlist your options, check the mandate for your pick, then buy it or tell me why not.",
          });
          continue;
        }
        finalText = res.text;
        break;
      }
    }
  } catch (e) {
    // Money already moved (or a hold was placed) → the errand's outcome stands; only the prose is missing.
    if (!run.outcome) throw e;
    console.warn("[agent] model failed after the outcome was decided; writing the summary from the ledger", e);
  }

  const status: ErrandStatus = run.outcome ?? (searches === 0 ? "refused" : "no_buy");
  if (status === "refused" && !getErrand(userId, errandId)?.errand.tape.length) {
    tape({ kind: "refuse", detail: "outside mandate" });
  }
  const reply = clean(finalText);
  updateErrand(errandId, { status, reply: reply.length ? reply : ledgerSummary(userId, errandId), model: modelName || undefined });
  return getErrand(userId, errandId)!.errand;
}

/** Plain, factual summary straight from the ledger, used when the model can't write one. */
function ledgerSummary(userId: string, errandId: string): string[] {
  const e = getErrand(userId, errandId)?.errand;
  const pick = e?.options.find((o) => o.picked);
  if (!e || !pick) return ["Done. See the ledger tape for every step."];
  if (e.status === "bought") return [`I bought ${pick.title} from ${pick.retailer} for ${money(pick.price)} with your PayPal wallet.`];
  if (e.status === "needs_you") return [`I picked ${pick.title} from ${pick.retailer} for ${money(pick.price)}, and I’m holding it for your signature.`];
  return ["Done. See the ledger tape for every step."];
}

// Internal flag names must never reach the user.
function plainWhy(why: string) {
  return why
    .replace(/\bprice_looks_off\b/gi, "odd price")
    .replace(/\bover_budget\b/gi, "over budget")
    .replace(/\bcondition:\s*/gi, "")
    .replace(/\bflagged\s+(?=odd price)/gi, "")
    .trim();
}

// Models occasionally slip into markdown despite instructions; the UI wants plain paragraphs.
function clean(text: string) {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^#+\s*/gm, "")
    .replace(/\s*\((?:product(?: id)?|id)[:\s]+[A-Za-z0-9_-]+\)/gi, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, " ").trim())
    .filter(Boolean)
    .slice(0, 4);
}
