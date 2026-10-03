import "server-only";
import { generateText, Output } from "ai";
import { z } from "zod";
import { withFallback } from "./llm";
import type { MandateDraft } from "./types";

const schema = z.object({
  purpose: z.string().describe("one short line naming what the agent may buy, e.g. 'Home-office computer peripherals'"),
  covers: z.array(z.string()).describe("3-6 concrete item types that are in scope"),
  excludes: z.array(z.string()).describe("item types or behaviours the user ruled out (can be empty)"),
  monthly_budget_usd: z.number().describe("total the agent may spend per calendar month"),
  ask_above_usd: z.number().describe("single purchases above this need the user's approval"),
  expires: z.string().describe("YYYY-MM-DD the mandate ends"),
});

/** Turn the user's own words into a structured mandate draft they review before signing. */
export async function draftMandate(text: string): Promise<MandateDraft> {
  const today = new Date().toISOString().slice(0, 10);
  const { value } = await withFallback(({ model }) =>
    generateText({
      model,
      maxRetries: 0,
      output: Output.object({ schema }),
      system: `You turn a person's description of what their shopping agent may buy into a precise spending mandate.
Today is ${today}. Be conservative: when something is unclear, choose the safer, narrower reading.
Defaults when not stated: monthly budget 100, ask-above 40% of the monthly budget rounded to a whole dollar, expires 60 days from today.
Never raise a number the user stated. Currency is USD.`,
      prompt: text,
    }),
  );
  const o = value.output;
  return {
    purpose: o.purpose.trim(),
    covers: o.covers.map((s) => s.trim()).filter(Boolean).slice(0, 8),
    excludes: o.excludes.map((s) => s.trim()).filter(Boolean).slice(0, 6),
    monthlyBudget: Math.max(1, Math.round(o.monthly_budget_usd * 100) / 100),
    askAbove: Math.max(0, Math.min(o.ask_above_usd, o.monthly_budget_usd)),
    expires: /^\d{4}-\d{2}-\d{2}$/.test(o.expires) ? o.expires : new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10),
  };
}
