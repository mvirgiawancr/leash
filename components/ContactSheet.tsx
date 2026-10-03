"use client";

import { useState } from "react";
import type { Errand } from "@/lib/types";
import { usd } from "./format";

type Mark = "pick" | "strike" | "fade" | "none";
type Card = {
  productId: string;
  title: string;
  retailer: string;
  price: number;
  image?: string;
  mark: Mark;
  note?: string;
  why?: string;
};

/**
 * A photo editor's contact sheet, marked up in grease pencil.
 * While the agent works it shows every listing it looked at; once it has decided, the sheet
 * folds down to the pick and its runner-ups (with the agent's reasons), and the full sheet
 * stays one click away.
 */
export function ContactSheet({ errand }: { errand: Errand }) {
  const [showAll, setShowAll] = useState(false);
  if (!errand.found.length) return null;

  const decided = errand.options.length > 0;
  const working = errand.status === "running";
  const pick = errand.options.find((o) => o.picked)?.productId;
  const pickNote = errand.status === "needs_you" ? "needs you" : errand.status === "bought" ? "this one" : "pick";
  const noteOf = new Map(errand.found.map((c) => [c.productId, c.note]));

  const full: Card[] = errand.found.map((c) => {
    const shortlisted = errand.options.some((o) => o.productId === c.productId);
    const mark: Mark = !decided ? "none" : c.productId === pick ? "pick" : shortlisted ? "strike" : "fade";
    return {
      ...c,
      mark,
      note: mark === "pick" ? pickNote : mark === "strike" ? (c.note ?? "runner-up") : mark === "fade" ? c.note : undefined,
    };
  });

  // pick first, then runner-ups, each with the agent's one-line reason
  const shortlist: Card[] = [...errand.options]
    .sort((a, b) => Number(!!b.picked) - Number(!!a.picked))
    .map((o) => ({
      productId: o.productId,
      title: o.title,
      retailer: o.retailer,
      price: o.price,
      image: o.image,
      why: o.why,
      mark: o.picked ? "pick" : "strike",
      note: o.picked ? pickNote : (noteOf.get(o.productId) ?? "runner-up"),
    }));

  const compact = decided && !working && !showAll;
  const cards = compact ? shortlist : full;

  return (
    <figure
      className={`sheet ${!decided ? "is-scanning" : ""} ${compact ? "is-compact" : ""}`}
      aria-label={compact ? "The agent's pick and runner-ups" : `${errand.found.length} listings the agent looked at`}
    >
      <figcaption className="sheet-head">
        <span>{compact ? "The pick" : "Contact sheet"}</span>
        {decided && !working ? (
          <button type="button" className="sheet-toggle" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Show only the shortlist" : `Show all ${errand.found.length} listings`}
          </button>
        ) : (
          <span>
            {errand.found.length} listings looked at{decided ? ` · ${errand.options.length} shortlisted` : ""}
          </span>
        )}
      </figcaption>
      <ol className="sheet-strip">
        {cards.map((c, i) => (
          <li key={c.productId} className={`frame m-${c.mark}`} style={{ animationDelay: `${i * 70}ms` }}>
            <span className="frame-no">{i + 1}A</span>
            <div className="frame-photo">
              {c.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.image} alt="" loading="lazy" />
              ) : (
                <span className="frame-blank" />
              )}
              {c.mark === "pick" && (
                <svg className="pencil circle" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
                  <path
                    d="M52 6 C 22 4, 4 22, 6 50 C 8 80, 30 96, 54 94 C 82 92, 97 72, 95 46 C 93 20, 74 5, 44 9"
                    pathLength={1}
                  />
                </svg>
              )}
              {c.mark === "strike" && (
                <svg className="pencil strike" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
                  <path d="M10 12 L 90 88" pathLength={1} />
                  <path d="M88 14 L 14 86" pathLength={1} />
                </svg>
              )}
              {c.note && <span className="scrawl">{c.note}</span>}
            </div>
            <div className="frame-cap">
              <span className="num">{usd(c.price)}</span>
              <span className="frame-shop">{c.retailer.replace(/^www\./, "")}</span>
            </div>
            {compact && (
              <div className="frame-why">
                <b>{c.title}</b>
                {c.why && <span>{c.why}</span>}
              </div>
            )}
          </li>
        ))}
      </ol>
    </figure>
  );
}
