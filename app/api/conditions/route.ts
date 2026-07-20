// Current conditions for every harbor. The browser rates them client-side
// against the user's boat + skill, so this endpoint is personalization-agnostic.

import { getAllConditions } from "@/lib/conditions";

export const dynamic = "force-dynamic";

export async function GET() {
  const harbors = await getAllConditions();
  return Response.json({ updatedAt: new Date().toISOString(), harbors });
}
