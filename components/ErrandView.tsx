"use client";

import type { Errand, Mandate } from "@/lib/types";
import { ContactSheet } from "./ContactSheet";
import { MoneyRoute } from "./MoneyRoute";
import { clock, day, usd } from "./format";

const STAMP: Partial<Record<Errand["status"], { text: string; tone: string }>> = {
  bought: { text: "Bought", tone: "green" },
  refused: { text: "Refused", tone: "red" },
  needs_you: { text: "Held", tone: "red" },
  declined: { text: "Declined", tone: "ink" },
  refunded: { text: "Refunded", tone: "ink" },
  no_buy: { text: "No buy", tone: "ink" },
  failed: { text: "Stopped", tone: "red" },
};

type Props = {
  errand: Errand;
  mandate: Mandate;
  busy?: "approve" | "decline" | "refund" | null;
  onApprove?: () => void;
  onDecline?: () => void;
  onRefund?: () => void;
};

export function ErrandView({ errand, mandate, busy, onApprove, onDecline, onRefund }: Props) {
  const stamp = STAMP[errand.status];
  const running = errand.status === "running";
  return (
    <article className={`errand ${running ? "is-running" : ""}`}>
      <div className="errand-head">
        <span>
          Errand · {day(errand.createdAt)} {clock(errand.createdAt).slice(0, 5)} UTC
        </span>
        <span>{errand.model ? `agent: ${errand.model}` : running ? "agent at work" : ""}</span>
      </div>

      <h2 className="errand-ask">{errand.ask}</h2>
      {stamp && (
        <span className={`stamp ${stamp.tone}`} key={errand.status}>
          {stamp.text}
        </span>
      )}

      <ContactSheet errand={errand} />

      {running && errand.reply.length === 0 && (
        <p className="working">
          {errand.options.length ? "Checking the pick against your mandate" : errand.found.length ? "Comparing listings" : "Reading listings"}
          <span className="dots" aria-hidden>
            <i />
            <i />
            <i />
          </span>
        </p>
      )}

      {errand.reply.length > 0 && (
        <div className="reply">
          {errand.reply.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      )}

      {/* errands from before the contact sheet existed keep the plain table */}
      {errand.options.length > 0 && errand.found.length === 0 && (
        <table className="options">
          <thead>
            <tr>
              <th className="mark" />
              <th className="thumb-col" />
              <th>Option</th>
              <th className="hide-sm">Retailer</th>
              <th className="amt">Price</th>
            </tr>
          </thead>
          <tbody>
            {errand.options.map((o) => (
              <tr key={o.productId} className={o.picked ? "picked" : ""}>
                <td className="mark">{o.picked ? "✓" : "·"}</td>
                <td className="thumb-col">
                  {o.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="thumb" src={o.image} alt="" loading="lazy" />
                  ) : (
                    <span className="thumb empty" />
                  )}
                </td>
                <td>
                  <div className="title">{o.title}</div>
                  {o.why && <div className="why">{o.why}</div>}
                  <div className="retailer-sm">{o.retailer}</div>
                </td>
                <td className="hide-sm">{o.retailer}</td>
                <td className="amt num">{usd(o.price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {errand.status === "needs_you" && errand.approval && (
        <div className="slip" role="group" aria-label="Approval needed">
          {errand.approval.image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="slip-img" src={errand.approval.image} alt="" />
          )}
          <div>
            <h3>Needs your signature</h3>
            <p>
              {errand.approval.title} · <span className="num">{usd(errand.approval.amount)}</span>
            </p>
            <div className="rule-note">
              {errand.approval.reason === "not_new" ? (
                <>This listing is used or refurbished. Leash only buys new items on its own.</>
              ) : errand.approval.reason === "odd_price" ? (
                <>This is priced far below similar listings. It could be a listing error or an accessory, so Leash won’t buy it without you.</>
              ) : (
                <>
                  Your mandate lets Leash spend up to {usd(mandate.askAbove)} on its own. This is{" "}
                  {usd(errand.approval.amount - mandate.askAbove)} over.
                </>
              )}
            </div>
          </div>
          <div className="slip-actions">
            <button className="btn ghost" onClick={onDecline} disabled={!!busy}>
              {busy === "decline" ? "Declining…" : "Decline"}
            </button>
            <button className="btn approve" onClick={onApprove} disabled={!!busy}>
              {busy === "approve" ? "Paying with PayPal…" : `Approve ${usd(errand.approval.amount)}`}
            </button>
          </div>
        </div>
      )}

      <MoneyRoute errand={errand} onRefund={onRefund} busy={busy === "refund"} />
    </article>
  );
}
