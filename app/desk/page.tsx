import { redirect } from "next/navigation";
import { DeskClient } from "@/components/DeskClient";
import { getMandate, getWallet, listErrands, saveShipTo } from "@/lib/db";
import { getShipTo } from "@/lib/paypal";
import { userId } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Desk() {
  const uid = await userId();
  let wallet = await getWallet(uid);
  if (!wallet) redirect("/");
  if (!wallet.shipTo) {
    // wallets connected before Leash read the address: fetch it once from the vault token
    const shipTo = await getShipTo(wallet.vaultId).catch(() => undefined);
    if (shipTo) {
      await saveShipTo(uid, shipTo);
      wallet = { ...wallet, shipTo };
    }
  }
  const mandate = await getMandate(uid);
  if (!mandate) redirect("/mandate");
  const month = new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
<DeskClient errands={await listErrands(uid)} mandate={mandate} wallet={wallet} month={month} />
  );
}
