"use client";

import type { Errand, ShipTo } from "@/lib/types";
import { usd } from "./format";

const STAMP = {
  bought: { text: "Bought", tone: "green" },
  needs_you: { text: "Held", tone: "red" },
  refunded: { text: "Refunded", tone: "ink" },
} as const;

type Item = { id: string; title: string; retailer: string; price: number; image?: string; status: keyof typeof STAMP };

function itemOf(e: Errand): Item | null {
  if (!(e.status in STAMP)) return null;
  const pick = e.options.find((o) => o.picked);
  const a = e.approval;
  const src = e.status === "needs_you" && a ? { ...a, price: a.amount } : pick;
  if (!src) return null;
  return { id: e.id, title: src.title, retailer: src.retailer, price: src.price, image: src.image, status: e.status as Item["status"] };
}

/** The latest thing Leash bought (or is holding), as a parcel tag tied to the ledger, plus this month's shelf. */
export function ParcelTag({ errands, shipTo }: { errands: Errand[]; shipTo?: ShipTo }) {
  const items = errands.map(itemOf).filter((i): i is Item => i !== null);
  if (!items.length) return null;
  const [top, ...rest] = items;
  const s = STAMP[top.status];
  return (
    <div className="parcel">
      <div className={`tag is-${top.status}`} key={top.id + top.status}>
        <span className="tag-hole" aria-hidden />
        <div className="tag-photo">
          {top.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={top.image} alt="" />
          ) : null}
          <span className={`stamp ${s.tone}`}>{s.text}</span>
        </div>
        <div className="tag-body">
          <span className="tag-title">{top.title}</span>
          <span className="tag-meta">
            <span>{top.retailer}</span>
            <span className="num">{usd(top.price)}</span>
          </span>
          {top.status === "needs_you" && <span className="tag-wait">waiting for your signature</span>}
          {shipTo && top.status !== "refunded" && (
            <address className="tag-ship" title="Shipping address from your PayPal wallet">
              <span className="tag-ship-k">Ship to</span>
              <span className="tag-ship-v">
                {shipTo.name && <>{shipTo.name}, </>}
                {shipTo.line1}, {shipTo.city}
                {shipTo.postal ? ` ${shipTo.postal}` : ""}, {shipTo.country}
              </span>
            </address>
          )}
        </div>
      </div>

      {rest.length > 0 && (
        <ul className="shelf" aria-label="Earlier this month">
          {rest.slice(0, 6).map((i) => (
            <li key={i.id} className={`is-${i.status}`} title={`${i.title} · ${usd(i.price)}`}>
              {i.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={i.image} alt={i.title} loading="lazy" />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
