import { authorizeCron, placeholderJobResponse } from "../../../../lib/cron";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const unauthorized = authorizeCron(request);
  if (unauthorized) {
    return unauthorized;
  }

  return placeholderJobResponse("enrich-positions");
}
