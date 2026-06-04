import { NextResponse } from "next/server";
import { Client } from "pg";
import { authorizeCron } from "../../../../lib/cron";
import { maintainKnownWallets } from "../../../../lib/fx-wallet-maintenance";

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
  try {
    await client.connect();
    const result = await maintainKnownWallets(client);
    return NextResponse.json({
      ok: true,
      jobName: "maintain-known-wallets",
      status: "completed",
      ...result,
      message:
        "Known wallets were seeded from current-position snapshots and any indexed position-transfer history available in Postgres. Realized PnL remains not_indexed until manager-operation cashflows are indexed."
    });
  } catch (error) {
    console.error("maintain-known-wallets failed", error);
    return NextResponse.json({ ok: false, error: "maintain-known-wallets failed" }, { status: 500 });
  } finally {
    await client.end().catch(() => undefined);
  }
}
