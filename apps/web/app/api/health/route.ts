import { NextResponse } from "next/server";
import { Client } from "pg";

export const dynamic = "force-dynamic";

type DatabaseHealth = "ok" | "missing_database_url" | "error";

async function checkDatabase(): Promise<{ status: DatabaseHealth; error?: string }> {
  if (!process.env.DATABASE_URL) {
    return { status: "missing_database_url" };
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5_000
  });

  try {
    await client.connect();
    await client.query("select 1");
    return { status: "ok" };
  } catch (error) {
    return { status: "error", error: error instanceof Error ? error.message : "Unknown database error" };
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function GET() {
  const database = await checkDatabase();
  const provider = process.env.GOLDSKY_SUBGRAPH_URL
    ? "goldsky"
    : process.env.THE_GRAPH_SUBGRAPH_URL
      ? "the_graph"
      : process.env.ENVIO_HASURA_QUERY_URL || process.env.HASURA_GRAPHQL_QUERY_URL
        ? "envio_hasura"
        : null;

  return NextResponse.json({
    ok: database.status === "ok",
    app: process.env.NEXT_PUBLIC_APP_NAME ?? "fx-trader-profiles",
    database,
    subgraph: {
      configured: Boolean(provider),
      provider
    },
    timestamp: new Date().toISOString()
  });
}
