"use client";

import { useId } from "react";
import type { MandateDraft } from "@/lib/types";
import { usd } from "./format";

const longDate = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** Guilloché-ish security pattern, like cheque stock. */
function Security() {
  const id = useId().replace(/:/g, "");
  return (
    <svg className="security" aria-hidden preserveAspectRatio="none">
      <defs>
        <pattern id={`g${id}`} width="120" height="28" patternUnits="userSpaceOnUse">
          <path d="M0 14 C 20 2, 40 2, 60 14 S 100 26, 120 14" fill="none" stroke="currentColor" strokeWidth="0.6" />
          <path d="M0 14 C 20 26, 40 26, 60 14 S 100 2, 120 14" fill="none" stroke="currentColor" strokeWidth="0.6" />
          <path d="M0 7 C 30 0, 30 14, 60 7 S 90 0, 120 7" fill="none" stroke="currentColor" strokeWidth="0.35" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#g${id})`} />
    </svg>
  );
}

export function Signature({ drawn }: { drawn: boolean }) {
  return (
    <svg className={`signature ${drawn ? "drawn" : ""}`} viewBox="0 0 220 60" aria-hidden>
      <path
        d="M6 42 C 18 10, 26 8, 28 30 S 34 52, 44 30 S 60 6, 62 34 C 63 46, 70 46, 78 30 C 84 18, 90 22, 92 34 C 94 44, 104 40, 112 28 C 118 20, 124 24, 122 36 C 121 44, 132 44, 142 30 C 150 20, 160 18, 170 30 C 176 37, 190 36, 214 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
      />
    </svg>
  );
}

type Props = {
  draft: MandateDraft;
  payer?: string;
  signed?: boolean;
  editable?: boolean;
  onChange?: (d: MandateDraft) => void;
  serial?: string;
};

export function MandateCard({ draft, payer, signed = false, editable = false, onChange, serial = "LSH-0001" }: Props) {
  const set = <K extends keyof MandateDraft>(k: K, v: MandateDraft[K]) => onChange?.({ ...draft, [k]: v });
  const list = (v: string) =>
    v
      .split(/[,;·]/)
      .map((s) => s.trim())
      .filter(Boolean);

  return (
    <div className={`mandate ${signed ? "is-signed" : ""}`}>
      <Security />
      <div className="mandate-top">
        <span className="mandate-kind">Spending mandate</span>
        <span className="num">No. {serial}</span>
      </div>

      <p className="mandate-sentence">
        I let <b>Leash</b> spend up to{" "}
        {editable ? (
          <input
            className="field num w-amt"
            type="number"
            min={1}
            step="1"
            value={draft.monthlyBudget}
            onChange={(e) => set("monthlyBudget", Number(e.target.value))}
            aria-label="Monthly budget in USD"
          />
        ) : (
          <span className="fill num">{usd(draft.monthlyBudget)}</span>
        )}{" "}
        a month on{" "}
        {editable ? (
          <input className="field w-purpose" value={draft.purpose} onChange={(e) => set("purpose", e.target.value)} aria-label="Purpose" />
        ) : (
          <span className="fill">{draft.purpose.charAt(0).toLowerCase() + draft.purpose.slice(1)}</span>
        )}
        .
      </p>

      <dl className="mandate-terms">
        <div>
          <dt>Covers</dt>
          <dd>
            {editable ? (
              <input className="field w-full" value={draft.covers.join(", ")} onChange={(e) => set("covers", list(e.target.value))} aria-label="Covers" />
            ) : (
              draft.covers.join(" · ")
            )}
          </dd>
        </div>
        <div>
          <dt>Never</dt>
          <dd>
            {editable ? (
              <input
                className="field w-full"
                value={draft.excludes.join(", ")}
                placeholder="nothing excluded"
                onChange={(e) => set("excludes", list(e.target.value))}
                aria-label="Excludes"
              />
            ) : draft.excludes.length ? (
              draft.excludes.join(" · ")
            ) : (
              "—"
            )}
          </dd>
        </div>
        <div>
          <dt>Ask me first above</dt>
          <dd>
            {editable ? (
              <input
                className="field num w-amt"
                type="number"
                min={0}
                step="1"
                value={draft.askAbove}
                onChange={(e) => set("askAbove", Number(e.target.value))}
                aria-label="Ask above, USD"
              />
            ) : (
              <span className="num">{usd(draft.askAbove)}</span>
            )}{" "}
            per item
          </dd>
        </div>
        <div>
          <dt>Valid until</dt>
          <dd>
            {editable ? (
              <input className="field num w-date" type="date" value={draft.expires} onChange={(e) => set("expires", e.target.value)} aria-label="Valid until" />
            ) : (
              longDate(draft.expires)
            )}
          </dd>
        </div>
      </dl>

      <div className="mandate-sign">
        <div className="sigline">
          <Signature drawn={signed} />
          <span>{signed ? "Signed" : "Signature"}</span>
        </div>
        <div className="sigline">
          <span className="num wallet-id">{payer ?? "—"}</span>
          <span>Paid from PayPal wallet</span>
        </div>
      </div>
    </div>
  );
}
