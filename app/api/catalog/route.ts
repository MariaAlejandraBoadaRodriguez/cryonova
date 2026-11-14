import { publicCatalog } from "@/src/catalog";
import { searchCatalog } from "@/src/catalog/search";
import { json } from "@/src/lib/request";

export const dynamic = "force-dynamic";

/** Curated, live-verified catalog. With ?q= returns ranked matches (EN/ES). */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.slice(0, 120) ?? "";
  if (q) {
    return json({ query: q, hits: searchCatalog(q).map((h) => ({ key: h.variable.key, score: h.score, matched: h.matched })) });
  }
  return json(publicCatalog(), { headers: { "cache-control": "public, max-age=300" } });
}
