import { redirect } from "next/navigation";
import { Wordmark } from "@/components/Bar";
import { MandateComposer } from "@/components/MandateComposer";
import { getMandate, getWallet } from "@/lib/db";
import { userId } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function MandatePage() {
  const uid = await userId();
  const [wallet, mandate] = await Promise.all([getWallet(uid), getMandate(uid)]);
  if (!wallet) redirect("/");
  return (
    <>
      <header className="bar slim">
        <Wordmark />
        <span className="step">Step 2 of 2 · sign a mandate</span>
        <span className="wallet">
          <span className="dot" />
          PayPal connected
        </span>
      </header>
      <main className="compose">
        <MandateComposer payer={wallet.payerEmail} hasMandate={!!mandate} />
      </main>
    </>
  );
}
