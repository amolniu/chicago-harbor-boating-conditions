import { describe, it, expect } from "vitest";
import { RECALL_URL, recallSearchUrl } from "./recalls";

describe("recallSearchUrl", () => {
  it("pre-fills the search with the boat name", () => {
    const url = new URL(recallSearchUrl("Catalina 30"));
    expect(url.origin + url.pathname).toBe(RECALL_URL);
    expect(url.searchParams.get("q")).toBe("Catalina 30");
  });

  it("escapes names that would otherwise break the query string", () => {
    // Custom boat names are free text — "J/24" and "Beneteau 40 & co" are legal.
    expect(new URL(recallSearchUrl("J/24")).searchParams.get("q")).toBe("J/24");
    expect(new URL(recallSearchUrl("Beneteau 40 & co")).searchParams.get("q")).toBe("Beneteau 40 & co");
  });

  it("falls back to the plain site for a missing or blank name", () => {
    // An unnamed boat should land on the site, not search for an empty string.
    for (const v of [undefined, null, "", "   "]) {
      expect(recallSearchUrl(v)).toBe(RECALL_URL);
    }
  });
});
