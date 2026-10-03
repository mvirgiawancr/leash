export type Mandate = {
  id: string;
  purpose: string; // one line, e.g. "Home-office computer peripherals"
  covers: string[]; // concrete things that are in scope
  excludes: string[]; // things explicitly out of scope
  monthlyBudget: number;
  askAbove: number; // purchases above this need a human signature
  expires: string; // ISO date
  spent: number; // this calendar month
};

export type MandateDraft = Omit<Mandate, "id" | "spent">;

// The buyer's shipping address as PayPal stores it on the vaulted wallet
export type ShipTo = {
  name: string;
  line1: string;
  city: string;
  region?: string;
  postal?: string;
  country: string;
};

export type Wallet = {
  vaultId: string;
  payerEmail: string;
  shipTo?: ShipTo;
};

export type TapeKind = "search" | "pick" | "check" | "hold" | "charge" | "payout" | "refuse" | "refund" | "approve" | "decline" | "error";

export type TapeLine = {
  at: string; // ISO
  kind: TapeKind;
  detail: string;
  amount?: number; // signed: negative = money out of the buyer's wallet
  ref?: string; // PayPal order / capture / payout / refund id
};

export type Option = {
  productId: string;
  title: string;
  retailer: string;
  price: number;
  image?: string;
  url?: string;
  rating?: number;
  why?: string;
  picked?: boolean;
};

// Every listing the agent looked at, for the contact sheet
export type FoundCard = {
  productId: string;
  title: string;
  retailer: string;
  price: number;
  image?: string;
  condition?: string; // only set when not "new"
  oddPrice?: boolean;
  note?: string; // grease-pencil note, frozen when the agent decided
};

export type ErrandStatus = "running" | "bought" | "needs_you" | "refused" | "no_buy" | "declined" | "refunded" | "failed";

export type Errand = {
  id: string;
  ask: string;
  createdAt: string;
  status: ErrandStatus;
  reply: string[];
  options: Option[];
  found: FoundCard[];
  tape: TapeLine[];
  approval?: {
    productId: string;
    title: string;
    retailer: string;
    amount: number;
    image?: string;
    reason?: "above_limit" | "odd_price" | "not_new";
  };
  receipt?: { order: string; capture: string; payout?: string; refund?: string };
  model?: string;
  purchaseId?: string;
};

// NDJSON events streamed from /api/errands while the agent works
export type ErrandEvent =
  | { type: "start"; errand: Errand }
  | { type: "tape"; line: TapeLine }
  | { type: "options"; options: Option[] }
  | { type: "found"; found: FoundCard[] }
  | { type: "status"; status: ErrandStatus; approval?: Errand["approval"] }
  | { type: "done"; errand: Errand; mandate: Mandate }
  | { type: "error"; message: string };
