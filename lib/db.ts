import "server-only";
import { neon } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";
import type { Errand, ErrandStatus, FoundCard, Mandate, Option, ShipTo, TapeLine, Wallet } from "./types";

// Neon serverless Postgres over HTTP: no connection pool to manage on Vercel functions.
function url() {
  const u = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!u) throw new Error("Missing env DATABASE_URL (Neon Postgres connection string)");
  return u;
}
const g = globalThis as unknown as { __leashSql?: ReturnType<typeof neon>; __leashSchema?: Promise<unknown> };
const sql = () => (g.__leashSql ??= neon(url()));

// Timestamps are ISO strings (TEXT) so they compare and serialize the same everywhere.
function schema() {
  const q = sql();
  return (g.__leashSchema ??= q.transaction([
    q.query(`CREATE TABLE IF NOT EXISTS wallets (
      user_id TEXT PRIMARY KEY, vault_id TEXT, customer_id TEXT, payer_email TEXT,
      setup_token TEXT, ship_to JSONB, created_at TEXT NOT NULL)`),
    q.query(`CREATE TABLE IF NOT EXISTS mandates (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, purpose TEXT NOT NULL, covers JSONB NOT NULL,
      excludes JSONB NOT NULL, monthly_budget DOUBLE PRECISION NOT NULL, ask_above DOUBLE PRECISION NOT NULL,
      expires TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL)`),
    q.query(`CREATE TABLE IF NOT EXISTS errands (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, mandate_id TEXT NOT NULL, ask TEXT NOT NULL,
      status TEXT NOT NULL, reply JSONB NOT NULL DEFAULT '[]', options JSONB NOT NULL DEFAULT '[]',
      found JSONB NOT NULL DEFAULT '[]', approval JSONB, receipt JSONB, model TEXT, created_at TEXT NOT NULL)`),
    q.query(`CREATE TABLE IF NOT EXISTS tape (
      id BIGSERIAL PRIMARY KEY, errand_id TEXT NOT NULL, at TEXT NOT NULL,
      kind TEXT NOT NULL, detail TEXT NOT NULL, amount DOUBLE PRECISION, ref TEXT)`),
    q.query(`CREATE TABLE IF NOT EXISTS purchases (
      id TEXT PRIMARY KEY, errand_id TEXT NOT NULL, mandate_id TEXT NOT NULL, user_id TEXT NOT NULL,
      product_id TEXT NOT NULL, title TEXT NOT NULL, retailer TEXT NOT NULL, amount DOUBLE PRECISION NOT NULL,
      order_id TEXT NOT NULL, capture_id TEXT NOT NULL, payout_batch TEXT, refund_id TEXT,
      status TEXT NOT NULL, created_at TEXT NOT NULL)`),
    q.query(`CREATE INDEX IF NOT EXISTS errands_user ON errands (user_id, created_at DESC)`),
    q.query(`CREATE INDEX IF NOT EXISTS tape_errand ON tape (errand_id, id)`),
    q.query(`CREATE INDEX IF NOT EXISTS purchases_mandate ON purchases (mandate_id, status, created_at)`),
  ]));
}

async function db() {
  await schema();
  return sql();
}

const now = () => new Date().toISOString();
export const newId = (p: string) => `${p}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const json = (v: unknown) => (v === undefined || v === null ? null : JSON.stringify(v));

/* ---------- wallet ---------- */

type WalletRow = { vault_id: string | null; payer_email: string | null; ship_to: ShipTo | null };

export async function getWallet(userId: string): Promise<Wallet | null> {
  const q = await db();
  const [r] = (await q`SELECT vault_id, payer_email, ship_to FROM wallets WHERE user_id = ${userId}`) as WalletRow[];
  if (!r?.vault_id) return null;
  return { vaultId: r.vault_id, payerEmail: r.payer_email ?? "", shipTo: r.ship_to ?? undefined };
}

export async function saveShipTo(userId: string, shipTo: ShipTo) {
  const q = await db();
  await q`UPDATE wallets SET ship_to = ${json(shipTo)}::jsonb WHERE user_id = ${userId}`;
}

export async function saveSetupToken(userId: string, setupToken: string) {
  const q = await db();
  await q`INSERT INTO wallets (user_id, setup_token, created_at) VALUES (${userId}, ${setupToken}, ${now()})
          ON CONFLICT (user_id) DO UPDATE SET setup_token = EXCLUDED.setup_token`;
}

export async function getSetupToken(userId: string) {
  const q = await db();
  const [r] = (await q`SELECT setup_token FROM wallets WHERE user_id = ${userId}`) as { setup_token: string | null }[];
  return r?.setup_token ?? null;
}

export async function saveVault(userId: string, vaultId: string, customerId: string, payerEmail: string) {
  const q = await db();
  await q`UPDATE wallets SET vault_id = ${vaultId}, customer_id = ${customerId}, payer_email = ${payerEmail} WHERE user_id = ${userId}`;
}

/* ---------- mandate ---------- */

type MandateRow = {
  id: string;
  purpose: string;
  covers: string[];
  excludes: string[];
  monthly_budget: number;
  ask_above: number;
  expires: string;
};

const monthStart = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
};

export async function spentThisMonth(mandateId: string) {
  const q = await db();
  const [r] = (await q`SELECT COALESCE(SUM(amount), 0) AS s FROM purchases
                       WHERE mandate_id = ${mandateId} AND status = 'settled' AND created_at >= ${monthStart()}`) as { s: number }[];
  return Math.round(Number(r.s) * 100) / 100;
}

export async function getMandate(userId: string): Promise<Mandate | null> {
  const q = await db();
  const [r] = (await q`SELECT * FROM mandates WHERE user_id = ${userId} AND status = 'active'
                       ORDER BY created_at DESC LIMIT 1`) as MandateRow[];
  if (!r) return null;
  return {
    id: r.id,
    purpose: r.purpose,
    covers: r.covers,
    excludes: r.excludes,
    monthlyBudget: r.monthly_budget,
    askAbove: r.ask_above,
    expires: r.expires,
    spent: await spentThisMonth(r.id),
  };
}

export async function signMandate(userId: string, m: Omit<Mandate, "id" | "spent">) {
  const q = await db();
  const id = newId("m");
  await q.transaction([
    q`UPDATE mandates SET status = 'replaced' WHERE user_id = ${userId} AND status = 'active'`,
    q`INSERT INTO mandates (id, user_id, purpose, covers, excludes, monthly_budget, ask_above, expires, status, created_at)
      VALUES (${id}, ${userId}, ${m.purpose}, ${json(m.covers)}::jsonb, ${json(m.excludes)}::jsonb,
              ${m.monthlyBudget}, ${m.askAbove}, ${m.expires}, 'active', ${now()})`,
  ]);
  return id;
}

/* ---------- errands + tape ---------- */

type ErrandRow = {
  id: string;
  ask: string;
  status: ErrandStatus;
  reply: string[];
  options: Option[];
  found: FoundCard[] | null;
  approval: Errand["approval"] | null;
  receipt: Errand["receipt"] | null;
  model: string | null;
  created_at: string;
  mandate_id: string;
};

type TapeRow = { errand_id: string; at: string; kind: TapeLine["kind"]; detail: string; amount: number | null; ref: string | null };

/** Hydrate errands with their tape and latest purchase in two queries total, not two per errand. */
async function hydrate(rows: ErrandRow[]): Promise<Errand[]> {
  if (!rows.length) return [];
  const q = await db();
  const ids = rows.map((r) => r.id);
  const [tape, purchases] = (await q.transaction([
    q`SELECT errand_id, at, kind, detail, amount, ref FROM tape WHERE errand_id = ANY(${ids}) ORDER BY id`,
    q`SELECT DISTINCT ON (errand_id) errand_id, id FROM purchases WHERE errand_id = ANY(${ids})
      ORDER BY errand_id, created_at DESC`,
  ])) as [TapeRow[], { errand_id: string; id: string }[]];
  return rows.map((r) => ({
    id: r.id,
    ask: r.ask,
    createdAt: r.created_at,
    status: r.status,
    reply: r.reply ?? [],
    options: r.options ?? [],
    found: r.found ?? [],
    approval: r.approval ?? undefined,
    receipt: r.receipt ?? undefined,
    model: r.model ?? undefined,
    purchaseId: purchases.find((p) => p.errand_id === r.id)?.id,
    tape: tape
      .filter((l) => l.errand_id === r.id)
      .map((l) => ({ at: l.at, kind: l.kind, detail: l.detail, amount: l.amount ?? undefined, ref: l.ref ?? undefined })),
  }));
}

export async function listErrands(userId: string): Promise<Errand[]> {
  const q = await db();
  const rows = (await q`SELECT * FROM errands WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 30`) as ErrandRow[];
  return hydrate(rows);
}

export async function getErrand(userId: string, id: string) {
  const q = await db();
  const [r] = (await q`SELECT * FROM errands WHERE id = ${id} AND user_id = ${userId}`) as ErrandRow[];
  if (!r) return null;
  const [errand] = await hydrate([r]);
  return { errand, mandateId: r.mandate_id };
}

export async function createErrand(userId: string, mandateId: string, ask: string) {
  const q = await db();
  const id = newId("e");
  await q`INSERT INTO errands (id, user_id, mandate_id, ask, status, created_at)
          VALUES (${id}, ${userId}, ${mandateId}, ${ask}, 'running', ${now()})`;
  return id;
}

const ERRAND_COLUMNS = new Set(["status", "reply", "options", "found", "approval", "receipt", "model"]);
const TEXT_COLUMNS = new Set(["status", "model"]);

export async function updateErrand(
  id: string,
  patch: Partial<{
    status: ErrandStatus;
    reply: string[];
    options: Option[];
    found: FoundCard[];
    approval: Errand["approval"] | null;
    receipt: Errand["receipt"];
    model: string;
  }>,
) {
  const sets: string[] = [];
  const vals: (string | null)[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || !ERRAND_COLUMNS.has(k)) continue; // column names come from this allow-list only
    vals.push(TEXT_COLUMNS.has(k) ? (v as string) : json(v));
    sets.push(`${k} = $${vals.length}${TEXT_COLUMNS.has(k) ? "" : "::jsonb"}`);
  }
  if (!sets.length) return;
  vals.push(id);
  const q = await db();
  await q.query(`UPDATE errands SET ${sets.join(", ")} WHERE id = $${vals.length}`, vals);
}

export async function addTape(errandId: string, line: Omit<TapeLine, "at">): Promise<TapeLine> {
  const full = { at: now(), ...line };
  const q = await db();
  await q`INSERT INTO tape (errand_id, at, kind, detail, amount, ref)
          VALUES (${errandId}, ${full.at}, ${full.kind}, ${full.detail}, ${full.amount ?? null}, ${full.ref ?? null})`;
  return full;
}

/* ---------- purchases ---------- */

export async function recordPurchase(p: {
  errandId: string;
  mandateId: string;
  userId: string;
  productId: string;
  title: string;
  retailer: string;
  amount: number;
  orderId: string;
  captureId: string;
  payoutBatch?: string;
}) {
  const q = await db();
  const id = newId("p");
  await q`INSERT INTO purchases (id, errand_id, mandate_id, user_id, product_id, title, retailer, amount,
                                 order_id, capture_id, payout_batch, status, created_at)
          VALUES (${id}, ${p.errandId}, ${p.mandateId}, ${p.userId}, ${p.productId}, ${p.title}, ${p.retailer}, ${p.amount},
                  ${p.orderId}, ${p.captureId}, ${p.payoutBatch ?? null}, 'settled', ${now()})`;
  return id;
}

export async function getPurchase(userId: string, id: string) {
  const q = await db();
  const [r] = (await q`SELECT * FROM purchases WHERE id = ${id} AND user_id = ${userId}`) as {
    id: string;
    errand_id: string;
    capture_id: string;
    amount: number;
    title: string;
    status: string;
  }[];
  return r;
}

export async function markRefunded(id: string, refundId: string) {
  const q = await db();
  await q`UPDATE purchases SET status = 'refunded', refund_id = ${refundId} WHERE id = ${id}`;
}
