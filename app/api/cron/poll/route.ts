// Scheduled poll: fetch every harbor's conditions and store a snapshot. Drive it
// from an external scheduler every ~15 min (Vercel Hobby cron only fires daily).
// Guarded by CRON_SECRET via ?secret= or an Authorization: Bearer header.

import { getAllConditions, persistSnapshots } from "@/lib/conditions";
import { historyEnabled } from "@/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const url = new URL(req.url);
    const provided =
      url.searchParams.get("secret") ||
      req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (provided !== secret) return new Response("Unauthorized", { status: 401 });
  }

  const list = await getAllConditions();
  const { persisted } = await persistSnapshots(list);

  return Response.json({
    ok: true,
    polledAt: new Date().toISOString(),
    harbors: list.length,
    persisted,
    historyEnabled: historyEnabled(),
  });
}
