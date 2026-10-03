import "server-only";

function need(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name} (see .env.example)`);
  return v;
}

export const env = {
  paypalClientId: () => need("PAYPAL_CLIENT_ID"),
  paypalSecret: () => need("PAYPAL_CLIENT_SECRET"),
  channel3Key: () => need("CHANNEL3_API_KEY"),
  groqKey: () => process.env.GROQ_API_KEY,
  geminiKey: () => process.env.GEMINI_API_KEY,
  // every "retailer" settles into this sandbox business account (Channel3 checkout isn't live yet)
  retailerPayoutEmail: () => need("RETAILER_PAYOUT_EMAIL"),
};
