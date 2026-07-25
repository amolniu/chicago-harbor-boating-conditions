// Bundled seed dataset of common boats for the "add boat" typeahead. There is no
// public boat-specs API, so we ship a curated list and auto-fill from it. Specs
// are approximate seed values (LOA/beam ft, displacement/ballast lb, draft ft) —
// a living dataset to expand and refine over time, like the harbor-exposure data.

import { BoatCategory } from "./boatSpecs";

export interface CatalogBoat {
  name: string;
  category: BoatCategory;
  loaFt: number;
  beamFt: number;
  displacementLb: number;
  ballastLb: number;
  draftFt: number;
}

export const BOAT_CATALOG: CatalogBoat[] = [
  { name: "Catalina 22", category: "D", loaFt: 21.5, beamFt: 7.7, displacementLb: 2490, ballastLb: 800, draftFt: 3.5 },
  { name: "Catalina 25", category: "C", loaFt: 25, beamFt: 8, displacementLb: 4550, ballastLb: 1900, draftFt: 4.0 },
  { name: "Catalina 27", category: "C", loaFt: 26.8, beamFt: 8.85, displacementLb: 6850, ballastLb: 2700, draftFt: 4.0 },
  { name: "Catalina 30", category: "C", loaFt: 29.9, beamFt: 10.83, displacementLb: 10200, ballastLb: 4200, draftFt: 5.25 },
  { name: "Catalina 34", category: "C", loaFt: 34.5, beamFt: 11.75, displacementLb: 11950, ballastLb: 5000, draftFt: 5.5 },
  { name: "Catalina 36", category: "C", loaFt: 36.4, beamFt: 11.9, displacementLb: 13500, ballastLb: 6000, draftFt: 5.75 },
  { name: "Catalina 42", category: "B", loaFt: 41.7, beamFt: 13.83, displacementLb: 20500, ballastLb: 8000, draftFt: 6.0 },
  { name: "Beneteau Oceanis 31", category: "C", loaFt: 31, beamFt: 10.5, displacementLb: 9500, ballastLb: 2800, draftFt: 5.75 },
  { name: "Beneteau Oceanis 34", category: "C", loaFt: 33.7, beamFt: 11.4, displacementLb: 11500, ballastLb: 3400, draftFt: 6.25 },
  { name: "Beneteau Oceanis 37", category: "B", loaFt: 36.9, beamFt: 12.5, displacementLb: 14300, ballastLb: 4400, draftFt: 6.4 },
  { name: "Beneteau Oceanis 40", category: "B", loaFt: 39.9, beamFt: 13.4, displacementLb: 17400, ballastLb: 5300, draftFt: 6.9 },
  { name: "Beneteau First 36.7", category: "C", loaFt: 36, beamFt: 11.5, displacementLb: 12800, ballastLb: 5000, draftFt: 6.9 },
  { name: "Jeanneau Sun Odyssey 349", category: "C", loaFt: 33.5, beamFt: 11.2, displacementLb: 11700, ballastLb: 3500, draftFt: 6.4 },
  { name: "Jeanneau Sun Odyssey 410", category: "B", loaFt: 40, beamFt: 13.1, displacementLb: 17600, ballastLb: 5300, draftFt: 6.9 },
  { name: "Hunter 27", category: "C", loaFt: 27, beamFt: 9.4, displacementLb: 7000, ballastLb: 2600, draftFt: 4.0 },
  { name: "Hunter 33", category: "C", loaFt: 33, beamFt: 11.5, displacementLb: 11200, ballastLb: 3600, draftFt: 5.5 },
  { name: "Hunter 36", category: "B", loaFt: 35.5, beamFt: 12.5, displacementLb: 14000, ballastLb: 4200, draftFt: 6.5 },
  { name: "Hunter 40", category: "B", loaFt: 40, beamFt: 13.5, displacementLb: 18000, ballastLb: 5500, draftFt: 6.5 },
  { name: "J/22", category: "C", loaFt: 22.5, beamFt: 8, displacementLb: 1790, ballastLb: 700, draftFt: 3.8 },
  { name: "J/24", category: "C", loaFt: 24, beamFt: 8.9, displacementLb: 3100, ballastLb: 950, draftFt: 4.0 },
  { name: "J/30", category: "C", loaFt: 29.9, beamFt: 11.2, displacementLb: 7000, ballastLb: 3100, draftFt: 5.25 },
  { name: "J/35", category: "C", loaFt: 35.4, beamFt: 11.9, displacementLb: 10500, ballastLb: 4200, draftFt: 6.9 },
  { name: "J/70", category: "C", loaFt: 22.75, beamFt: 7.4, displacementLb: 1750, ballastLb: 800, draftFt: 4.9 },
  { name: "J/105", category: "C", loaFt: 34.5, beamFt: 11, displacementLb: 7750, ballastLb: 3400, draftFt: 6.5 },
  { name: "J/109", category: "B", loaFt: 35.5, beamFt: 11.2, displacementLb: 10650, ballastLb: 4200, draftFt: 7.0 },
  { name: "J/120", category: "B", loaFt: 40, beamFt: 12.3, displacementLb: 13500, ballastLb: 5100, draftFt: 7.5 },
  { name: "Tartan 34", category: "C", loaFt: 34.4, beamFt: 10, displacementLb: 11200, ballastLb: 5000, draftFt: 4.9 },
  { name: "Tartan 37", category: "B", loaFt: 37, beamFt: 11.75, displacementLb: 15500, ballastLb: 6500, draftFt: 4.5 },
  { name: "Pearson 30", category: "C", loaFt: 30, beamFt: 9.75, displacementLb: 8500, ballastLb: 3500, draftFt: 4.9 },
  { name: "Pearson 323", category: "C", loaFt: 32.3, beamFt: 10.5, displacementLb: 11000, ballastLb: 4400, draftFt: 4.9 },
  { name: "Pearson 365", category: "B", loaFt: 36.5, beamFt: 11.5, displacementLb: 16500, ballastLb: 6000, draftFt: 4.5 },
  { name: "C&C 30", category: "C", loaFt: 30, beamFt: 10, displacementLb: 8000, ballastLb: 3400, draftFt: 5.25 },
  { name: "C&C 34", category: "C", loaFt: 34, beamFt: 11, displacementLb: 10000, ballastLb: 4400, draftFt: 5.75 },
  { name: "Sabre 362", category: "B", loaFt: 36.2, beamFt: 12, displacementLb: 14300, ballastLb: 5800, draftFt: 5.0 },
  { name: "Ericson 35", category: "C", loaFt: 35, beamFt: 11, displacementLb: 12000, ballastLb: 5000, draftFt: 5.5 },
  { name: "Cal 34", category: "C", loaFt: 34, beamFt: 10, displacementLb: 10500, ballastLb: 4500, draftFt: 5.5 },
  { name: "Cal 40", category: "B", loaFt: 39.5, beamFt: 11, displacementLb: 15500, ballastLb: 6000, draftFt: 5.5 },
  { name: "Islander 36", category: "C", loaFt: 36.75, beamFt: 11.2, displacementLb: 13450, ballastLb: 6000, draftFt: 5.25 },
  { name: "Bristol 40", category: "A", loaFt: 40, beamFt: 10.75, displacementLb: 18000, ballastLb: 7000, draftFt: 5.5 },
  { name: "Island Packet 350", category: "A", loaFt: 35, beamFt: 12, displacementLb: 16500, ballastLb: 6600, draftFt: 4.5 },
  { name: "Island Packet 380", category: "A", loaFt: 38, beamFt: 12.9, displacementLb: 20000, ballastLb: 8000, draftFt: 4.8 },
  { name: "Hallberg-Rassy 40", category: "A", loaFt: 40, beamFt: 12.6, displacementLb: 22000, ballastLb: 9000, draftFt: 6.4 },
  { name: "Nonsuch 30", category: "C", loaFt: 30.4, beamFt: 11.8, displacementLb: 12000, ballastLb: 4200, draftFt: 4.5 },
  { name: "O'Day 27", category: "C", loaFt: 26.9, beamFt: 9.5, displacementLb: 6000, ballastLb: 2400, draftFt: 4.0 },
  { name: "Melges 24", category: "C", loaFt: 24, beamFt: 8.2, displacementLb: 1750, ballastLb: 750, draftFt: 5.0 },
  { name: "MacGregor 26", category: "D", loaFt: 25.8, beamFt: 7.75, displacementLb: 2550, ballastLb: 300, draftFt: 5.75 },
  { name: "Precision 23", category: "D", loaFt: 23, beamFt: 8, displacementLb: 2650, ballastLb: 900, draftFt: 4.0 },
  { name: "Laser", category: "D", loaFt: 13.8, beamFt: 4.5, displacementLb: 130, ballastLb: 0, draftFt: 0.5 },
  { name: "Sunfish", category: "D", loaFt: 13.75, beamFt: 4.1, displacementLb: 120, ballastLb: 0, draftFt: 0.5 },
  { name: "Hobie 16", category: "D", loaFt: 16.7, beamFt: 7.9, displacementLb: 320, ballastLb: 0, draftFt: 0.75 },
  { name: "Flying Scot", category: "D", loaFt: 19, beamFt: 6.75, displacementLb: 850, ballastLb: 0, draftFt: 0.66 },
  { name: "Lightning", category: "D", loaFt: 19, beamFt: 6.5, displacementLb: 700, ballastLb: 130, draftFt: 0.5 },
  { name: "Thistle", category: "D", loaFt: 17, beamFt: 6, displacementLb: 515, ballastLb: 0, draftFt: 0.75 },
];

/** Case-insensitive typeahead over the catalog; startsWith ranks above contains. */
export function searchCatalog(query: string, limit = 8): CatalogBoat[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored = BOAT_CATALOG.map((b) => {
    const n = b.name.toLowerCase();
    const score = n.startsWith(q) ? 0 : n.includes(q) ? 1 : 2;
    return { b, score };
  }).filter((x) => x.score < 2);
  scored.sort((a, z) => a.score - z.score || a.b.name.localeCompare(z.b.name));
  return scored.slice(0, limit).map((x) => x.b);
}
