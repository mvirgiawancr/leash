"use client";

import type { Errand } from "@/lib/types";
import { usd } from "./format";

const shortRef = (ref?: string) => ref?.replace(/^(order|batch|refund)\s+/, "") ?? "";

/**
 * Where the money actually went, drawn from the ledger lines PayPal confirmed:
 * your PayPal → Leash (Orders, vault) → retailer (Payouts), and back again on a refund.
 */
export function MoneyRoute({ errand, onRefund, busy }: { errand: Errand; onRefund?: () => void; busy?: boolean }) {
  const charge = errand.tape.find((l) => l.kind === "charge");
  if (!charge) return null;
  const payout = errand.tape.find((l) => l.kind === "payout");
  const refund = errand.tape.find((l) => l.kind === "refund");
  const retailer = payout?.detail ?? errand.options.find((o) => o.picked)?.retailer ?? "retailer";
  const amount = Math.abs(charge.amount ?? 0);

  return (
    <figure className={`route ${refund ? "is-refunded" : ""}`} aria-label="Where the money went">
      <div className="route-line">
        <div className="stop">
          <span className="pin" />
          <b>Your PayPal</b>
          <span>saved wallet</span>
        </div>
        <div className="leg" key={`c-${charge.at}`}>
          <span className="leg-track" />
          <span className="runner">
            <i />
          </span>
          <span className="leg-label">
            <span>
              Orders API · <span className="num">−{usd(amount)}</span>
            </span>
            <span className="num ref">{shortRef(charge.ref)}</span>
          </span>
        </div>
        <div className="stop">
          <span className="pin" />
          <b>Leash</b>
          <span>merchant of record</span>
        </div>
        <div className={`leg ${payout ? "" : "is-pending"}`} key={`p-${payout?.at ?? "none"}`}>
          <span className="leg-track" />
          {payout && (
            <span className="runner late">
              <i />
            </span>
          )}
          <span className="leg-label">
            <span>
              Payouts API · <span className="num">{payout ? usd(amount) : "pending"}</span>
            </span>
            <span className="num ref">{shortRef(payout?.ref)}</span>
          </span>
        </div>
        <div className="stop">
          <span className="pin" />
          <b>{retailer}</b>
          <span>retailer</span>
        </div>
      </div>

      {refund && (
        <div className="refund-leg" key={`r-${refund.at}`}>
          <span className="leg-track" />
          <span className="runner back">
            <i />
          </span>
          <span className="leg-label">
            <span>
              Refund via Agent Toolkit · <span className="num">+{usd(amount)}</span> back to you
            </span>
            <span className="num ref">{shortRef(refund.ref)}</span>
          </span>
        </div>
      )}

      {errand.status === "bought" && errand.purchaseId && (
        <figcaption>
          <button className="linkish" onClick={onRefund} disabled={busy}>
            {busy ? "Refunding…" : "Not right? Refund it"}
          </button>
        </figcaption>
      )}
    </figure>
  );
}
