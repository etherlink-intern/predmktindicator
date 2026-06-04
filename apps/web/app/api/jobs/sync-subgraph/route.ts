import { Client } from "pg";
import { NextResponse } from "next/server";
import { authorizeCron } from "../../../../lib/cron";
import { syncFxEventHistoryFromHasura } from "../../../../lib/fx-history-sync";

export const dynamic = "force-dynamic";

function getDatabaseUrl() {
  return process.env.DATABASE_URL;
}

export async function POST(request: Request) {
  const unauthorized = authorizeCron(request);
  if (unauthorized) {
    return unauthorized;
  }

  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    return NextResponse.json({ ok: false, error: "DATABASE_URL is not configured" }, { status: 500 });
  }

  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 });
  await client.connect();
  try {
    const result = await syncFxEventHistoryFromHasura(client);
    return NextResponse.json({ ok: true, jobName: "sync-subgraph", ...result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, jobName: "sync-subgraph", error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}
