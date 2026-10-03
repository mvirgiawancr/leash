"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { MandateDraft } from "@/lib/types";
import { MandateCard } from "./MandateCard";

const EXAMPLE =
  "Keep my home office stocked: mice, keyboards, headsets, webcams, cables. No furniture, no gift cards. Max $120 a month, and ask me before anything over $45. Until the end of November.";

export function MandateComposer({ payer, hasMandate }: { payer: string; hasMandate: boolean }) {
  const router = useRouter();
  const [text, setText] = useState(EXAMPLE);
  const [draft, setDraft] = useState<MandateDraft | null>(null);
  const [state, setState] = useState<"idle" | "drafting" | "signing" | "signed">("idle");
  const [error, setError] = useState<string | null>(null);

  async function makeDraft() {
    setState("drafting");
    setError(null);
    try {
      const r = await fetch("/api/mandate/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setDraft(j.draft);
    } catch (e) {
      setError((e as Error).message || "Couldn’t draft that.");
    } finally {
      setState("idle");
    }
  }

  async function sign() {
    if (!draft) return;
    setState("signing");
    setError(null);
    const r = await fetch("/api/mandate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
    if (!r.ok) {
      setError((await r.json()).error ?? "Couldn’t sign.");
      setState("idle");
      return;
    }
    setState("signed");
    setTimeout(() => router.push("/desk"), 1400); // let the signature finish drawing
  }

  return (
    <div className="compose-grid">
      <div className="compose-left">
        <h1 className="page-title">Write the rules in your own words.</h1>
        <p className="page-lede">
          Leash reads what you write and drafts a mandate: what it may buy, how much a month, and when it has to ask you first. You check
          every number before you sign.
        </p>
        <label className="say" htmlFor="say">
          <span>What may Leash buy for you?</span>
          <textarea id="say" rows={6} value={text} onChange={(e) => setText(e.target.value)} disabled={state !== "idle"} />
        </label>
        <div className="compose-actions">
          <button className="btn" onClick={makeDraft} disabled={state !== "idle" || text.trim().length < 8}>
            {state === "drafting" ? "Drafting…" : draft ? "Redraft" : "Draft my mandate"}
          </button>
          {hasMandate && (
            <a className="linkish" href="/desk">
              Keep my current mandate
            </a>
          )}
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="compose-right">
        {draft ? (
          <>
            <MandateCard draft={draft} payer={payer} editable={state === "idle"} signed={state === "signed"} onChange={setDraft} />
            <div className="sign-row">
              <p>
                Leash will check every purchase against this before it touches your PayPal. The limits are enforced in code, not left to
                the model.
              </p>
              <button className="btn" onClick={sign} disabled={state !== "idle"}>
                {state === "signing" ? "Signing…" : state === "signed" ? "Signed" : "Sign mandate"}
              </button>
            </div>
          </>
        ) : (
          <div className="mandate-ghost" aria-hidden>
            <span>Your mandate appears here</span>
          </div>
        )}
      </div>
    </div>
  );
}
