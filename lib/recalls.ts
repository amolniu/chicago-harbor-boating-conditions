// Cross-links to Recall Monitor, our sister site, which aggregates recall databases
// including the USCG "Boats & Marine" one. Kept here rather than inline so the URL
// shape lives in one place — and because the harbor page's cold-water/PFD copy is a
// natural second home for it later.
//
// Isomorphic: pure string building, safe to import from client components.

export const RECALL_URL = "https://recall-monitor.web.app/";

/**
 * Link to the recall site, pre-filling its search with `query` when we have something
 * worth searching (a boat name like "Catalina 30" — the site searches the USCG database
 * by manufacturer or model).
 *
 * Falls back to the plain site URL for a missing or blank query, so an unnamed boat
 * never produces a search for nothing.
 */
export function recallSearchUrl(query?: string | null): string {
  const q = query?.trim();
  return q ? `${RECALL_URL}?q=${encodeURIComponent(q)}` : RECALL_URL;
}
