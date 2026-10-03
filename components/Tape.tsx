"use client";

import type { Errand, Mandate, TapeLine } from "@/lib/types";
import { clock, usd } from "./format";

const LABEL: Record<TapeLine["kind"], string> = {
  search: "SEARCH",
  pick: "PICK",
  check: "CHECK",
  hold: "HOLD",
  charge: "CHARGE",
  payout: "PAYOUT",
  refuse: "REFUSE",
  refund: "REFUND",
  approve: "SIGNED",
  decline: "DECLINE",
  error: "ERROR",
};

const tone = (k: TapeLine["kind"]) =>
  k === "charge" || k === "payout" || k === "refund"
    ? "money"
    : k === "hold" || k === "refuse" || k === "error"
      ? "block"
      : k === "check" || k === "approve"
        ? "ok"
        : "";

type Props = { errands: Errand[]; mandate: Mandate; freshAfter?: string; month: string };

export function Tape({ errands, mandate, freshAfter, month }: Props) {
  const ordered = [...errands].reverse();
  const held = errands.filter((e) => e.status === "needs_you").reduce((s, e) => s + (e.approval?.amount ?? 0), 0);
  const running = errands.some((e) => e.status === "running");
  const left = mandate.monthlyBudget - mandate.spent;
  return (
    <div className="tape-wrap">
      <div className="tape-label">
        <strong>Ledger tape</strong>
        <span>{month}</span>
      </div>
      <div className="tape">
        <div className="tape-head">
          <span className="big">leash</span>
          every move your agent makes, as it makes it
          <span className="tz">times in UTC</span>
        </div>
        {ordered.length === 0 && <div className="tape-empty">Nothing yet. Send Leash on an errand.</div>}
        {ordered.map((e) => (
          <div className="tape-group" key={e.id}>
            <div className="who">› {e.ask}</div>
            {e.tape.map((l, i) => (
              <div className={`tline ${tone(l.kind)} ${freshAfter && l.at > freshAfter ? "fresh" : ""}`} key={i}>
                <span className="t">{clock(l.at)}</span>
                <span className="k">{LABEL[l.kind]}</span>
                <span className="d" title={l.detail}>
                  {l.detail}
                </span>
                <span className="a">{l.amount != null ? usd(l.amount) : ""}</span>
                {l.ref && <span className="ref">{l.ref}</span>}
              </div>
            ))}
            {e.status === "running" && <div className="cursor" aria-hidden />}
          </div>
        ))}
        <div className="tape-total num">
          <div>
            <span>budget</span>
            <span>{usd(mandate.monthlyBudget)}</span>
          </div>
          <div>
            <span>spent</span>
            <span>{usd(-mandate.spent)}</span>
          </div>
          {held > 0 && (
            <div className="held">
              <span>waiting for you</span>
              <span>{usd(held)}</span>
            </div>
          )}
          <div className="grand">
            <span>left to spend</span>
            <span>{usd(left)}</span>
          </div>
        </div>
        <div className="tape-foot">{running ? "printing…" : "paypal sandbox · vault → orders → payouts"}</div>
      </div>
    </div>
  );
}
