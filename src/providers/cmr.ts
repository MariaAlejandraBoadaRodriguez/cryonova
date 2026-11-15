/**
 * NASA Earthdata CMR granule discovery. Returns, for each month, the granule
 * and its Cloud OPeNDAP service URL as published in the granule metadata.
 */
import { requestWithPolicy, type RequestPolicy } from "@/src/lib/http";

export const CMR_SEARCH = "https://cmr.earthdata.nasa.gov/search";

export interface GranuleRef {
  id: string;
  title: string;
  month: string;
  timeStart: string;
  opendapUrl: string | null;
}

interface CmrEntry {
  id: string;
  title: string;
  time_start: string;
  links?: Array<{ rel?: string; href: string }>;
}

interface CmrPage {
  entries: CmrEntry[];
  hits: number;
  searchAfter: string | null;
}

export function lastDayOfMonth(yearMonth: string): string {
  const [year, month] = yearMonth.split("-").map(Number) as [number, number];
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${yearMonth}-${String(day).padStart(2, "0")}`;
}

export function pickOpendapUrl(links: CmrEntry["links"]): string | null {
  const all = links ?? [];
  const cloud = all.find((l) => (l.rel ?? "").endsWith("/service#") && l.href.includes("opendap.earthdata.nasa.gov"));
  if (cloud) return cloud.href;
  const other = all.find((l) => (l.rel ?? "").endsWith("/service#") && /opendap/i.test(l.href) && !l.href.endsWith("/"));
  return other?.href ?? null;
}

export interface GranuleSearchResult {
  granules: GranuleRef[];
  hits: number;
  requests: number;
  durationMs: number;
  duplicateMonths: string[];
  queryUrl: string;
}

export interface GranuleSearchOptions {
  /** Keep only granules whose name contains this text (sent to CMR as a readable_granule_name pattern). */
  titleFilter?: string;
}

export async function findGranules(
  conceptId: string,
  start: string,
  end: string,
  policy: RequestPolicy,
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>,
  options: GranuleSearchOptions = {},
): Promise<GranuleSearchResult> {
  const params = new URLSearchParams({
    collection_concept_id: conceptId,
    temporal: `${start}-01T00:00:00Z,${lastDayOfMonth(end)}T23:59:59Z`,
    page_size: "2000",
    sort_key: "start_date",
  });
  if (options.titleFilter) {
    params.set("readable_granule_name[]", `*${options.titleFilter}*`);
    params.set("options[readable_granule_name][pattern]", "true");
  }
  const queryUrl = `${CMR_SEARCH}/granules.json?${params.toString()}`;
  const started = Date.now();
  const entries: CmrEntry[] = [];
  let hits = 0;
  let searchAfter: string | null = null;
  let requests = 0;

  do {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (searchAfter) headers["CMR-Search-After"] = searchAfter;
    const page = await requestWithPolicy<CmrPage>(
      queryUrl,
      { headers },
      policy,
      async (response) => {
        const body = (await response.json()) as { feed?: { entry?: CmrEntry[] } };
        return {
          entries: body.feed?.entry ?? [],
          hits: Number(response.headers.get("cmr-hits") ?? "0"),
          searchAfter: response.headers.get("cmr-search-after"),
        };
      },
      fetchImpl,
    );
    requests += 1;
    entries.push(...page.value.entries);
    hits = page.value.hits || entries.length;
    searchAfter = page.value.entries.length > 0 && entries.length < hits ? page.value.searchAfter : null;
  } while (searchAfter && requests < 5);

  const byMonth = new Map<string, GranuleRef>();
  const duplicateMonths: string[] = [];
  for (const entry of entries) {
    const month = entry.time_start.slice(0, 7);
    if (month < start || month > end) continue;
    if (options.titleFilter && !entry.title.includes(options.titleFilter)) continue;
    const ref: GranuleRef = { id: entry.id, title: entry.title, month, timeStart: entry.time_start, opendapUrl: pickOpendapUrl(entry.links) };
    const existing = byMonth.get(month);
    if (existing) {
      duplicateMonths.push(month);
      // Reprocessed MERRA-2 streams (e.g. MERRA2_401) sort after the original.
      if (ref.title > existing.title) byMonth.set(month, ref);
    } else {
      byMonth.set(month, ref);
    }
  }
  const granules = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
  return { granules, hits, requests, durationMs: Date.now() - started, duplicateMonths, queryUrl };
}
