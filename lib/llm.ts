import "server-only";
import { createGroq } from "@ai-sdk/groq";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import { env } from "./env";

export type ModelSlot = { name: string; model: LanguageModel };

// Groq first (fast), Gemini as the safety net when the free tier 429s / 503s.
export function modelChain(): ModelSlot[] {
  const chain: ModelSlot[] = [];
  const groqKey = env.groqKey();
  const geminiKey = env.geminiKey();
  if (groqKey) {
    const groq = createGroq({ apiKey: groqKey });
    chain.push({ name: "groq · gpt-oss-120b", model: groq("openai/gpt-oss-120b") });
    // separate free-tier rate-limit bucket, still solid at tool calling
    chain.push({ name: "groq · gpt-oss-20b", model: groq("openai/gpt-oss-20b") });
  }
  if (geminiKey) {
    const google = createGoogleGenerativeAI({ apiKey: geminiKey });
    chain.push({ name: "gemini · flash", model: google("gemini-flash-latest") });
    chain.push({ name: "gemini · 3.5-flash", model: google("gemini-3.5-flash") });
  }
  if (!chain.length) throw new Error("Set GROQ_API_KEY or GEMINI_API_KEY");
  return chain;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const retryable = (e: unknown) => {
  const s = (e as { statusCode?: number; status?: number })?.statusCode ?? (e as { status?: number })?.status;
  const msg = String((e as Error)?.message ?? e);
  return s === 429 || s === 500 || s === 502 || s === 503 || /overloaded|high demand|rate limit|timeout|fetch failed/i.test(msg);
};

// A model that just hit its per-minute quota is skipped until the window resets,
// so the remaining steps of an errand don't each burn a failed call on it.
const cooldownUntil = new Map<string, number>();

const quotaWait = (e: unknown) => {
  const msg = String((e as Error)?.message ?? e);
  if (!/rate limit|quota|tokens per minute|requests per minute|429/i.test(msg)) return 0;
  const m = msg.match(/try again in ([\d.]+)\s*(ms|s|m)/i);
  if (!m) return 60_000;
  const n = Number(m[1]);
  return Math.min(120_000, m[2] === "ms" ? n : m[2] === "m" ? n * 60_000 : n * 1000) + 500;
};

/** Run one model call, walking the chain on transient failures. */
export async function withFallback<T>(run: (slot: ModelSlot) => Promise<T>): Promise<{ value: T; slot: ModelSlot }> {
  let last: unknown;
  const chain = modelChain();
  const ready = chain.filter((s) => (cooldownUntil.get(s.name) ?? 0) < Date.now());
  for (const slot of ready.length ? ready : chain) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return { value: await run(slot), slot };
      } catch (e) {
        last = e;
        console.warn(`[llm] ${slot.name} failed (attempt ${attempt + 1}): ${String((e as Error)?.message ?? e).slice(0, 160)}`);
        const wait = quotaWait(e);
        if (wait) {
          cooldownUntil.set(slot.name, Date.now() + wait);
          break; // quota errors won't clear in a couple of seconds: move to the next model now
        }
        if (!retryable(e)) break;
        await sleep(1500 * (attempt + 1));
      }
    }
  }
  throw last;
}
