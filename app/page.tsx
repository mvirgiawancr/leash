import { Wordmark } from "@/components/Bar";
import { ConnectPayPal } from "@/components/ConnectPayPal";
import { HeroSpecimen } from "@/components/HeroSpecimen";
import { getMandate, getWallet } from "@/lib/db";
import { userId } from "@/lib/session";

export const dynamic = "force-dynamic";

const NOTICE: Record<string, string> = {
  cancelled: "You closed PayPal before approving. Nothing was connected.",
  failed: "PayPal approved, but saving the wallet failed. Try once more.",
  mismatch: "That PayPal approval didn’t match this browser. Start again here.",
};

const RULES = [
  {
    rule: "Outside the mandate",
    what: "“Buy me a standing desk” when the mandate covers peripherals. Leash declines before it even searches.",
    stamp: "Refused",
    tone: "red",
  },
  {
    rule: "Above your ask-first line",
    what: "A $59.99 headset against a $45 line. Leash picks it, holds it, and sends you a slip to sign.",
    stamp: "Held",
    tone: "red",
  },
  {
    rule: "Over the monthly budget",
    what: "Blocked in the purchase tool itself. No prompt, jailbreak or “I pre-approve everything” gets past it.",
    stamp: "Blocked",
    tone: "ink",
  },
];

export default async function Home({ searchParams }: PageProps<"/">) {
  const uid = await userId();
  const [wallet, mandate] = await Promise.all([getWallet(uid), getMandate(uid)]);
  const notice = NOTICE[String((await searchParams).wallet ?? "")];

  return (
    <>
      <header className="bar slim">
        <Wordmark />
        <span className="step">Built on PayPal sandbox</span>
        {wallet ? (
          <a className="linkish" href={mandate ? "/desk" : "/mandate"}>
            {mandate ? "Open your desk →" : "Sign your mandate →"}
          </a>
        ) : (
          <span />
        )}
      </header>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <h1>Give your agent a budget, not your card.</h1>
            <p className="lede">
              Leash shops for you inside a mandate you sign: what it may buy, how much a month, when it must ask. It pays through your
              PayPal, and every move it makes prints on a ledger you can read.
            </p>
            {notice && (
              <p className="form-error" role="status">
                {notice}
              </p>
            )}
            {!wallet ? (
              <ConnectPayPal />
            ) : (
              <div className="connect">
                <a className="btn big" href={mandate ? "/desk" : "/mandate"}>
                  {mandate ? "Open your desk" : "Sign your mandate"} <span aria-hidden>→</span>
                </a>
                <p className="connect-note">PayPal connected · {wallet.payerEmail}</p>
              </div>
            )}
          </div>
          <HeroSpecimen />
        </section>

        <section className="flow" aria-labelledby="flow-h">
          <h2 id="flow-h">Where the money goes</h2>
          <ol className="flow-line">
            <li>
              <b>Your PayPal</b>
              <span>approve once</span>
              <code>Vault API · setup → payment token</code>
            </li>
            <li>
              <b>Leash agent</b>
              <span>finds, compares, checks the mandate</span>
              <code>Groq gpt-oss-120b · Channel3 search</code>
            </li>
            <li>
              <b>Charge</b>
              <span>no card details, no re-login</span>
              <code>Orders API · vault_id</code>
            </li>
            <li>
              <b>Retailer</b>
              <span>Leash settles the order</span>
              <code>Payouts API</code>
            </li>
            <li className="back">
              <b>Back to you</b>
              <span>if it isn’t right</span>
              <code>Agent Toolkit · create_refund</code>
            </li>
          </ol>
        </section>

        <section className="rules" aria-labelledby="rules-h">
          <h2 id="rules-h">Three lines the model can’t cross</h2>
          <div className="rules-list">
            {RULES.map((r) => (
              <div className="rule-row" key={r.rule}>
                <h3>{r.rule}</h3>
                <p>{r.what}</p>
                <span className={`stamp ${r.tone}`}>{r.stamp}</span>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="foot">
        <span>Leash · PayPal AI Hackathon 2026</span>
        <span>Sandbox only. No real money moves.</span>
      </footer>
    </>
  );
}
