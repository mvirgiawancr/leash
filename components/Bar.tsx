import type { Mandate, Wallet } from "@/lib/types";
import { day, shortEmail, usd } from "./format";

export function Wordmark() {
  return (
    <a className="wordmark" href="/">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="7.5" cy="16.5" r="5" stroke="currentColor" strokeWidth="2.2" />
        <path d="M11 13c2.5-3 2-7 5-8.5 2-1 4 .2 5 2" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
      leash
    </a>
  );
}

export function Bar({ mandate, wallet }: { mandate: Mandate; wallet: Wallet }) {
  const left = mandate.monthlyBudget - mandate.spent;
  return (
    <header className="bar">
      <Wordmark />
      <div className="mandate-strip" aria-label="Active mandate">
        <span className="hide-md">
          Mandate · <strong>{mandate.purpose}</strong>
        </span>
        <span className="sep hide-md" />
        <span className="meter" title={`${usd(mandate.spent)} of ${usd(mandate.monthlyBudget)} spent`}>
          <span style={{ width: `${(mandate.spent / mandate.monthlyBudget) * 100}%` }} />
        </span>
        <span>
          <strong className="num">{usd(left)}</strong> left
          <span className="hide-sm"> of {usd(mandate.monthlyBudget)}</span>
        </span>
        <span className="sep hide-sm" />
        <span className="hide-sm">
          asks above <strong className="num">{usd(mandate.askAbove)}</strong>
        </span>
        <span className="sep hide-md" />
        <span className="hide-md">ends {day(mandate.expires)}</span>
      </div>
      <div className="wallet">
        <span className="dot" />
        PayPal · {shortEmail(wallet.payerEmail)}
      </div>
    </header>
  );
}
