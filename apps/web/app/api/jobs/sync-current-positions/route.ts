import { NextResponse } from "next/server";
import { authorizeCron } from "../../../../lib/cron";

export const dynamic = "force-dynamic";

function getTriggerCommand() {
  return process.env.FX_CURRENT_POSITIONS_SYNC_CMD || "";
}

export async function POST(request: Request) {
  const unauthorized = authorizeCron(request);
  if (unauthorized) return unauthorized;

  const cmd = getTriggerCommand();
  if (!cmd) {
    return NextResponse.json({ ok: false, error: "FX_CURRENT_POSITIONS_SYNC_CMD not configured" }, { status: 500 });
  }

  const { execSync } = await import("child_process");
  try {
    const output = execSync(cmd, { timeout: 300, encoding: "utf-8" });
    return NextResponse.json({ ok: true, jobName: "sync-current-positions", output: output.trim().split("\n").pop() });
  } catch (error) {
    return NextResponse.json(
      { ok: false, jobName: "sync-current-positions", error: String(error) },
      { status: 500 },
    );
  }
}
