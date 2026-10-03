import "server-only";
import { env } from "./env";
import type { Option } from "./types";

type C3Product = {
  id: string;
  title: string;
  images?: { url?: string }[] | string[];
  image_url?: string;
  key_features?: string[];
  ratings?: { average?: number; rating?: number };
  offers?: {
    price?: { price?: number; currency?: string } | number;
    domain?: string;
    retailer?: string;
    url?: string;
    condition?: string;
  }[];
};

export type Found = Option & { features: string[]; condition?: string };

export async function searchProducts(query: string, maxPrice?: number): Promise<Found[]> {
  const r = await fetch("https://api.trychannel3.com/v1/search", {
    method: "POST",
    headers: { "x-api-key": env.channel3Key(), "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      limit: 6,
      filters: { availability: ["InStock"], ...(maxPrice ? { price: { max_price: maxPrice } } : {}) },
    }),
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`Channel3 search ${r.status}`);
  const j = (await r.json()) as { products?: C3Product[] };
  return (j.products ?? [])
    .map((p) => {
      const o = p.offers?.[0] ?? {};
      const price = typeof o.price === "number" ? o.price : o.price?.price;
      const img = p.images?.[0];
      return {
        productId: p.id,
        title: p.title,
        retailer: o.domain ?? o.retailer ?? "unknown retailer",
        price: Number(price ?? NaN),
        url: o.url,
        image: typeof img === "string" ? img : img?.url ?? p.image_url,
        rating: p.ratings?.average ?? p.ratings?.rating,
        features: (p.key_features ?? []).slice(0, 3),
        condition: o.condition?.toLowerCase(),
      };
    })
    .filter((p) => Number.isFinite(p.price) && (!maxPrice || p.price <= maxPrice));
}
