// Scheduled station health check. Drive it weekly from the same Cloud Scheduler that
// runs /api/cron/poll (Bearer CRON_SECRET). Returns 200 when everything is healthy and
// 503 when something needs attention, so a scheduler, uptime monitor or curl in a shell
// can tell the difference without parsing the body.

import { runHealthCheck } from "@/lib/health";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const url = new URL(req.url);
    const provided =
      url.searchParams.get("secret") || req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (provided !== secret) return new Response("Unauthorized", { status: 401 });
  }

  const summary = await runHealthCheck();
  return Response.json(summary, { status: summary.ok ? 200 : 503 });
}
