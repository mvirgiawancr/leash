import "server-only";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Errand, ErrandStatus, FoundCard, Mandate, Option, ShipTo, TapeLine, Wallet } from "./types";

const dir = process.env.LEASH_DATA_DIR || join(process.cwd(), "data");
mkdirSync(dir, { recursive: true });

const g = globalThis as unknown as { __leashDb?: DatabaseSync };
const db = (g.__leashDb ??= open());

function open() {
  const d = new DatabaseSync(join(dir, "leash.db"));
  d.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS wallets (
      user_id TEXT PRIMARY KEY, vault_id TEXT, customer_id TEXT, payer_email TEXT,
      setup_token TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mandates (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, purpose TEXT NOT NULL, covers TEXT NOT NULL,
      excludes TEXT NOT NULL, monthly_budget REAL NOT NULL, ask_above REAL NOT NULL,
      expires TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS errands (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, mandate_id TEXT NOT NULL, ask TEXT NOT NULL,
      status TEXT NOT NULL, reply TEXT NOT NULL DEFAULT '[]', options TEXT NOT NULL DEFAULT '[]',
      approval TEXT, receipt TEXT, model TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tape (
      id INTEGER PRIMARY KEY AUTOINCREMENT, errand_id TEXT NOT NULL, at TEXT NOT NULL,
      kind TEXT NOT NULL, detail TEXT NOT NULL, amount REAL, ref TEXT
    );
    CREATE TABLE IF NOT EXISTS purchases (
      id TEXT PRIMARY KEY, errand_id TEXT NOT NULL, mandate_id TEXT NOT NULL, user_id TEXT NOT NULL,
      product_id TEXT NOT NULL, title TEXT NOT NULL, retailer TEXT NOT NULL, amount REAL NOT NULL,
      order_id TEXT NOT NULL, capture_id TEXT NOT NULL, payout_batch TEXT, refund_id TEXT,
      status TEXT NOT NULL, created_at TEXT NOT NULL
    );
  `);
  // columns added after the first release
  const cols = (d.prepare("PRAGMA table_info(errands)").all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes("found")) d.exec("ALTER TABLE errands ADD COLUMN found TEXT NOT NULL DEFAULT '[]'");
  const wcols = (d.prepare("PRAGMA table_info(wallets)").all() as { name: string }[]).map((c) => c.name);
  if (!wcols.includes("ship_to")) d.exec("ALTER TABLE wallets ADD COLUMN ship_to TEXT");
  return d;
}

const now = () => new Date().toISOString();
export const newId = (p: string) => `${p}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;

/* ---------- wallet ---------- */

type WalletRow = {
  user_id: string;
  vault_id: string | null;
  payer_email: string | null;
  setup_token: string | null;
  ship_to: string | null;
};

export function getWallet(userId: string): Wallet | null {
  const r = db.prepare("SELECT * FROM wallets WHERE user_id = ?").get(userId) as WalletRow | undefined;
  if (!r?.vault_id) return null;
  return { vaultId: r.vault_id, payerEmail: r.payer_email ?? "", shipTo: r.ship_to ? JSON.parse(r.ship_to) : undefined };
}

export function saveShipTo(userId: string, shipTo: ShipTo) {
  db.prepare("UPDATE wallets SET ship_to = ? WHERE user_id = ?").run(JSON.stringify(shipTo), userId);
}

export function saveSetupToken(userId: string, setupToken: string) {
  db.prepare(
    `INSERT INTO wallets (user_id, setup_token, created_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET setup_token = excluded.setup_token`,
  ).run(userId, setupToken, now());
}

export function getSetupToken(userId: string) {
  const r = db.prepare("SELECT setup_token FROM wallets WHERE user_id = ?").get(userId) as { setup_token: string | null } | undefined;
  return r?.setup_token ?? null;
}

export function saveVault(userId: string, vaultId: string, customerId: string, payerEmail: string) {
  db.prepare("UPDATE wallets SET vault_id = ?, customer_id = ?, payer_email = ? WHERE user_id = ?").run(
    vaultId,
    customerId,
    payerEmail,
    userId,
  );
}

/* ---------- mandate ---------- */

type MandateRow = {
  id: string;
  purpose: string;
  covers: string;
  excludes: string;
  monthly_budget: number;
  ask_above: number;
  expires: string;
};

const monthStart = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
};

export function spentThisMonth(mandateId: string) {
  const r = db
    .prepare("SELECT COALESCE(SUM(amount), 0) AS s FROM purchases WHERE mandate_id = ? AND status = 'settled' AND created_at >= ?")
    .get(mandateId, monthStart()) as { s: number };
  return Math.round(r.s * 100) / 100;
}

export function getMandate(userId: string): Mandate | null {
  const r = db
    .prepare("SELECT * FROM mandates WHERE user_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1")
    .get(userId) as MandateRow | undefined;
  if (!r) return null;
  return {
    id: r.id,
    purpose: r.purpose,
    covers: JSON.parse(r.covers),
    excludes: JSON.parse(r.excludes),
    monthlyBudget: r.monthly_budget,
    askAbove: r.ask_above,
    expires: r.expires,
    spent: spentThisMonth(r.id),
  };
}

export function signMandate(userId: string, m: Omit<Mandate, "id" | "spent">) {
  db.prepare("UPDATE mandates SET status = 'replaced' WHERE user_id = ? AND status = 'active'").run(userId);
  const id = newId("m");
  db.prepare(
    `INSERT INTO mandates (id, user_id, purpose, covers, excludes, monthly_budget, ask_above, expires, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
  ).run(id, userId, m.purpose, JSON.stringify(m.covers), JSON.stringify(m.excludes), m.monthlyBudget, m.askAbove, m.expires, now());
  return id;
}

/* ---------- errands + tape ---------- */

type ErrandRow = {
  id: string;
  ask: string;
  status: ErrandStatus;
  reply: string;
  options: string;
  found: string;
  approval: string | null;
  receipt: string | null;
  model: string | null;
  created_at: string;
  mandate_id: string;
  user_id: string;
};

function hydrate(r: ErrandRow): Errand {
  const tape = db
    .prepare("SELECT at, kind, detail, amount, ref FROM tape WHERE errand_id = ? ORDER BY id")
    .all(r.id) as TapeLine[];
  const purchase = db.prepare("SELECT id, status FROM purchases WHERE errand_id = ? ORDER BY created_at DESC LIMIT 1").get(r.id) as
    | { id: string; status: string }
    | undefined;
  return {
    id: r.id,
    ask: r.ask,
    createdAt: r.created_at,
    status: r.status,
    reply: JSON.parse(r.reply),
    options: JSON.parse(r.options),
    found: JSON.parse(r.found ?? "[]"),
    approval: r.approval ? JSON.parse(r.approval) : undefined,
    receipt: r.receipt ? JSON.parse(r.receipt) : undefined,
    model: r.model ?? undefined,
    purchaseId: purchase?.id,
    tape: tape.map((l) => ({ ...l, amount: l.amount ?? undefined, ref: l.ref ?? undefined })),
  };
}

export function listErrands(userId: string): Errand[] {
  const rows = db.prepare("SELECT * FROM errands WHERE user_id = ? ORDER BY created_at DESC LIMIT 30").all(userId) as ErrandRow[];
  return rows.map(hydrate);
}

export function getErrand(userId: string, id: string) {
  const r = db.prepare("SELECT * FROM errands WHERE id = ? AND user_id = ?").get(id, userId) as ErrandRow | undefined;
  return r ? { errand: hydrate(r), mandateId: r.mandate_id } : null;
}

export function createErrand(userId: string, mandateId: string, ask: string) {
  const id = newId("e");
  db.prepare("INSERT INTO errands (id, user_id, mandate_id, ask, status, created_at) VALUES (?, ?, ?, ?, 'running', ?)").run(
    id,
    userId,
    mandateId,
    ask,
    now(),
  );
  return id;
}

export function updateErrand(
  id: string,
  patch: Partial<{ status: ErrandStatus; reply: string[]; options: Option[]; found: FoundCard[]; approval: Errand["approval"] | null; receipt: Errand["receipt"]; model: string }>,
) {
  const cols: string[] = [];
  const vals: (string | null)[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    cols.push(`${k} = ?`);
    vals.push(typeof v === "string" ? v : v === null ? null : JSON.stringify(v));
  }
  if (cols.length) db.prepare(`UPDATE errands SET ${cols.join(", ")} WHERE id = ?`).run(...vals, id);
}

export function addTape(errandId: string, line: Omit<TapeLine, "at">): TapeLine {
  const full = { at: now(), ...line };
  db.prepare("INSERT INTO tape (errand_id, at, kind, detail, amount, ref) VALUES (?, ?, ?, ?, ?, ?)").run(
    errandId,
    full.at,
    full.kind,
    full.detail,
    full.amount ?? null,
    full.ref ?? null,
  );
  return full;
}

/* ---------- purchases ---------- */

export function recordPurchase(p: {
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
  const id = newId("p");
  db.prepare(
    `INSERT INTO purchases (id, errand_id, mandate_id, user_id, product_id, title, retailer, amount, order_id, capture_id, payout_batch, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'settled', ?)`,
  ).run(id, p.errandId, p.mandateId, p.userId, p.productId, p.title, p.retailer, p.amount, p.orderId, p.captureId, p.payoutBatch ?? null, now());
  return id;
}

export function getPurchase(userId: string, id: string) {
  return db.prepare("SELECT * FROM purchases WHERE id = ? AND user_id = ?").get(id, userId) as
    | { id: string; errand_id: string; capture_id: string; amount: number; title: string; status: string }
    | undefined;
}

export function markRefunded(id: string, refundId: string) {
  db.prepare("UPDATE purchases SET status = 'refunded', refund_id = ? WHERE id = ?").run(refundId, id);
}
