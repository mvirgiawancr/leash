import { MandateCard } from "./MandateCard";

// A looping, CSS-only replay of a real sandbox run (Oct 3, 2026): mandate → search → check → charge → payout.
const LINES = [
  { t: "13:42:01", k: "SEARCH", d: "ergonomic mouse ≤ $120", a: "" },
  { t: "13:42:20", k: "PICK", d: "Wave Vertical · upliftdesk", a: "" },
  { t: "13:42:21", k: "CHECK", d: "within mandate", a: "", tone: "ok" },
  { t: "13:42:23", k: "CHARGE", d: "PayPal wallet", a: "−$34.00", tone: "money" },
  { t: "13:42:24", k: "PAYOUT", d: "upliftdesk.com", a: "$34.00", tone: "money" },
];

export function HeroSpecimen() {
  return (
    <div className="specimen" aria-label="Example: a mandate and the ledger tape of a real sandbox run">
      <div className="specimen-card">
        <MandateCard
          draft={{
            purpose: "Home-office computer peripherals",
            covers: ["mice", "keyboards", "headsets", "webcams", "cables"],
            excludes: ["furniture", "gift cards"],
            monthlyBudget: 120,
            askAbove: 45,
            expires: "2026-11-30",
          }}
          payer="sb-qljcf…@personal"
          signed
        />
      </div>
      <div className="specimen-tape tape">
        <div className="tape-head">
          <span className="big">leash</span>
          ledger tape
        </div>
        <div className="tape-group">
          {LINES.map((l, i) => (
            <div className={`tline loop ${l.tone ?? ""}`} style={{ animationDelay: `${0.6 + i * 0.9}s` }} key={i}>
              <span className="t">{l.t}</span>
              <span className="k">{l.k}</span>
              <span className="d">{l.d}</span>
              <span className="a">{l.a}</span>
            </div>
          ))}
        </div>
        <span className="stamp green loop-stamp">Settled</span>
      </div>
    </div>
  );
}
