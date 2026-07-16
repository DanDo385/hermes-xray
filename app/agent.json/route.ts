import { getAgentManifest } from "@/lib/agent";

export const dynamic = "force-static";

export function GET() {
  return Response.json(getAgentManifest(), {
    headers: {
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
