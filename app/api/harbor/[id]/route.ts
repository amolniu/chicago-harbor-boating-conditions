// Detail bundle for one harbor: live conditions, buoy wind history (for the
// graph), hourly wind forecast, marine wave forecast + advisory, the NOAA
// forecast discussion, and sun times. The browser derives the rating + sail
// window from this against the user's boat + skill.

import { getHarbor } from "@/lib/harbors";
import { getHarborConditions, getStormHours } from "@/lib/conditions";
import { getBuoyWindHistory } from "@/lib/ndbc";
import { getGridpointHourly, getMarineForecast, getDiscussion } from "@/lib/nws";
import { getSunTimes } from "@/lib/astro";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const harbor = getHarbor(id);
  if (!harbor) return new Response("Harbor not found", { status: 404 });

  const [conditions, forecast, marine, discussion, stormHours] = await Promise.all([
    getHarborConditions(harbor),
    getGridpointHourly(harbor.waveGrid),
    getMarineForecast(harbor.marineZone),
    getDiscussion("LOT"),
    getStormHours(),
  ]);

  // Prefer the harbor's own station for wind history; fall back to 45198.
  let windHistory = await getBuoyWindHistory(harbor.buoyStation);
  if (windHistory.length < 3 && harbor.buoyStation !== "45198") {
    windHistory = await getBuoyWindHistory("45198");
  }

  const { sunrise, sunset } = getSunTimes(harbor.lat, harbor.lon);

  return Response.json({
    id: harbor.id,
    name: harbor.name,
    notes: harbor.notes,
    conditions,
    windHistory,
    forecast,
    marine: { advisory: marine.advisory, waveText: marine.waveText, headline: marine.headline },
    discussion: discussion ? { text: discussion.text, issued: discussion.issued } : null,
    sun: { sunrise: sunrise.toISOString(), sunset: sunset.toISOString() },
    stormHours,
    radarStation: "LOT",
  });
}
