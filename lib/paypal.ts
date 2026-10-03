import "server-only";
import { randomUUID } from "node:crypto";
import { PayPalAgentToolkit } from "@paypal/agent-toolkit/ai-sdk";
import { env } from "./env";
import type { ShipTo } from "./types";

const API = "https://api-m.sandbox.paypal.com";

let cached: { token: string; until: number } | null = null;

async function accessToken() {
  if (cached && cached.until > Date.now()) return cached.token;
  const r = await fetch(`${API}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${env.paypalClientId()}:${env.paypalSecret()}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  const j = await r.json();
  if (!r.ok) throw new PayPalError("oauth", r.status, j);
  cached = { token: j.access_token, until: Date.now() + (j.expires_in - 120) * 1000 };
  return cached.token;
}

export class PayPalError extends Error {
  constructor(
    public path: string,
    public status: number,
    public body: { name?: string; details?: { issue?: string }[]; message?: string },
  ) {
    super(`PayPal ${path} ${status}: ${body.details?.[0]?.issue ?? body.name ?? body.message ?? "error"}`);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      "Content-Type": "application/json",
      "PayPal-Request-Id": randomUUID(),
      Prefer: "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const text = await r.text();
  const j = text ? JSON.parse(text) : {};
  if (!r.ok) throw new PayPalError(path, r.status, j);
  return j as T;
}

/* Step 1 of connecting a wallet: buyer approves a billing agreement once, no purchase. */
export async function createSetupToken(origin: string) {
  const j = await call<{ id: string; links: { rel: string; href: string }[] }>("POST", "/v3/vault/setup-tokens", {
    payment_source: {
      paypal: {
        description: "Leash — your agent may spend within the mandate you sign",
        usage_type: "MERCHANT",
        customer_type: "CONSUMER",
        permit_multiple_payment_tokens: true,
        experience_context: {
          brand_name: "Leash",
          return_url: `${origin}/api/vault/return`,
          cancel_url: `${origin}/?wallet=cancelled`,
        },
      },
    },
  });
  return { id: j.id, approveUrl: j.links.find((l) => l.rel === "approve")!.href };
}

type PayPalShipping = {
  name?: { full_name?: string };
  address?: {
    address_line_1?: string;
    admin_area_2?: string;
    admin_area_1?: string;
    postal_code?: string;
    country_code?: string;
  };
};

function toShipTo(s?: PayPalShipping): ShipTo | undefined {
  const a = s?.address;
  if (!a?.address_line_1 || !a.country_code) return undefined;
  return {
    name: s?.name?.full_name ?? "",
    line1: a.address_line_1,
    city: a.admin_area_2 ?? "",
    region: a.admin_area_1,
    postal: a.postal_code,
    country: a.country_code,
  };
}

type PaymentToken = {
  id: string;
  customer: { id: string };
  payment_source: { paypal: { email_address?: string; shipping?: PayPalShipping } };
};

/* Step 2: exchange the approved setup token for a reusable payment token (vault_id).
   The token carries the buyer's PayPal shipping address, so Leash never asks for one. */
export async function createPaymentToken(setupTokenId: string) {
  const j = await call<PaymentToken>("POST", "/v3/vault/payment-tokens", {
    payment_source: { token: { id: setupTokenId, type: "SETUP_TOKEN" } },
  });
  return {
    vaultId: j.id,
    customerId: j.customer.id,
    payerEmail: j.payment_source.paypal.email_address ?? "",
    shipTo: toShipTo(j.payment_source.paypal.shipping),
  };
}

export async function getShipTo(vaultId: string) {
  const j = await call<PaymentToken>("GET", `/v3/vault/payment-tokens/${vaultId}`);
  return toShipTo(j.payment_source.paypal.shipping);
}

/* Merchant-initiated charge of the vaulted wallet. Completes on create, no buyer present. */
export async function chargeVault(vaultId: string, amount: number, description: string, shipTo?: ShipTo) {
  const unit = { description: description.slice(0, 127), amount: { currency_code: "USD", value: amount.toFixed(2) } };
  const shipping = shipTo && {
    type: "SHIPPING",
    name: { full_name: shipTo.name || "PayPal buyer" },
    address: {
      address_line_1: shipTo.line1,
      admin_area_2: shipTo.city,
      admin_area_1: shipTo.region,
      postal_code: shipTo.postal,
      country_code: shipTo.country,
    },
  };
  type Order = { id: string; status: string; purchase_units: { payments?: { captures?: { id: string; status: string }[] } }[] };
  const create = (withShipping: boolean) =>
    call<Order>("POST", "/v2/checkout/orders", {
      intent: "CAPTURE",
      purchase_units: [withShipping && shipping ? { ...unit, shipping } : unit],
      payment_source: { paypal: { vault_id: vaultId } },
    });
  let order: Order;
  try {
    order = await create(true);
  } catch (e) {
    // a rejected order is never created, so retrying without the address can't double-charge
    if (!(e instanceof PayPalError) || e.status >= 500 || !shipping) throw e;
    console.warn("[paypal] order with shipping rejected, retrying without:", e.message);
    order = await create(false);
  }
  let capture = order.purchase_units[0]?.payments?.captures?.[0];
  if (order.status !== "COMPLETED") {
    const done = await call<typeof order>("POST", `/v2/checkout/orders/${order.id}/capture`, {});
    capture = done.purchase_units[0]?.payments?.captures?.[0];
  }
  if (!capture || capture.status !== "COMPLETED") throw new Error(`Capture not completed for order ${order.id}`);
  return { orderId: order.id, captureId: capture.id };
}

/* Leash is merchant of record; it settles with the retailer through Payouts. */
export async function payRetailer(amount: number, note: string) {
  const j = await call<{ batch_header: { payout_batch_id: string } }>("POST", "/v1/payments/payouts", {
    sender_batch_header: { sender_batch_id: `leash-${randomUUID()}`, email_subject: "Leash order settlement" },
    items: [
      {
        recipient_type: "EMAIL",
        receiver: env.retailerPayoutEmail(),
        amount: { value: amount.toFixed(2), currency: "USD" },
        note: note.slice(0, 160),
      },
    ],
  });
  return j.batch_header.payout_batch_id;
}

/* Read-side + refunds go through PayPal's own agent toolkit. */
let toolkit: PayPalAgentToolkit | null = null;
export function paypalToolkit() {
  toolkit ??= new PayPalAgentToolkit({
    clientId: env.paypalClientId(),
    clientSecret: env.paypalSecret(),
    configuration: {
      actions: { payments: { createRefund: true, getRefunds: true }, orders: { get: true }, transactions: { list: true } },
      context: { sandbox: true },
    },
  });
  return toolkit;
}

export async function refundCapture(captureId: string, note: string) {
  const tools = paypalToolkit().getTools() as unknown as Record<string, { execute: (args: unknown) => Promise<unknown> }>;
  const raw = await tools.create_refund.execute({ capture_id: captureId, note_to_payer: note });
  const j = (typeof raw === "string" ? JSON.parse(raw) : raw) as { id?: string; status?: string; error?: unknown };
  if (!j?.id) throw new Error(`Refund failed: ${JSON.stringify(raw).slice(0, 200)}`);
  return { refundId: j.id, status: j.status };
}
