import { searchRegions } from "@/src/catalog/regions";
import { json } from "@/src/lib/request";

export const dynamic = "force-dynamic";

/** Region search by English name, alias or ISO code (English-only, D-35). */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.slice(0, 80) ?? "";
  return json({
    query: q,
    regions: searchRegions(q).map(({ region }) => ({ id: region.id, kind: region.kind, names: region.names, bbox: region.bbox })),
  });
}
