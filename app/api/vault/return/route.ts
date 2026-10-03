import { NextResponse, type NextRequest } from "next/server";
import { getMandate, getSetupToken, saveShipTo, saveVault } from "@/lib/db";
import { createPaymentToken } from "@/lib/paypal";
import { userId } from "@/lib/session";

// PayPal sends the buyer back here after they approve the billing agreement.
export async function GET(req: NextRequest) {
  const uid = await userId();
  const setupToken = await getSetupToken(uid);
  const returned = req.nextUrl.searchParams.get("approval_token_id");
  if (!setupToken || (returned && returned !== setupToken)) {
    return NextResponse.redirect(new URL("/?wallet=mismatch", req.url));
  }
  try {
    const { vaultId, customerId, payerEmail, shipTo } = await createPaymentToken(setupToken);
    await saveVault(uid, vaultId, customerId, payerEmail);
    if (shipTo) await saveShipTo(uid, shipTo);
  } catch (e) {
    console.error(e);
    return NextResponse.redirect(new URL("/?wallet=failed", req.url));
  }
  return NextResponse.redirect(new URL((await getMandate(uid)) ? "/desk" : "/mandate", req.url));
}
