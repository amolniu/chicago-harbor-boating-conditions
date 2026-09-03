// Afternoon history for one harbor: compact per-day summaries the browser re-rates
// with the user's own boat + skill (lib/history.ts). Served separately from the main
// detail bundle because history moves once a day, not once per poll.

import { getHarbor } from "@/lib/harbors";
import { historyEnabled } from "@/db";
import { getAfternoonHistory } from "@/db/history";
import { DEFAULT_TZ_FALLBACK } from "@/lib/history";

export const revalidate = 1800;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const harbor = getHarbor(id);
  if (!harbor) return new Response("Unknown harbor", { status: 404 });

  if (!historyEnabled()) {
    return Response.json({ enabled: false, days: [], today: null });
  }

  const days = (await getAfternoonHistory(harbor)) ?? [];
  // "Today" in the harbor's own timezone, so the streak window and the percentile
  // agree with what the person standing at that harbor calls today.
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: harbor.timezone ?? DEFAULT_TZ_FALLBACK,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  return Response.json({ enabled: true, days, today });
}
