import { NextResponse } from "next/server";

export function authorizeCron(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;

  if (process.env.NODE_ENV === "production" && !secret) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET is required in production" }, { status: 500 });
  }

  if (!secret) {
    return null;
  }

  const authorization = request.headers.get("authorization");
  if (authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  return null;
}

export function placeholderJobResponse(jobName: string) {
  return NextResponse.json({
    ok: true,
    jobName,
    status: "placeholder",
    message: "Worker implementation will be added in the MVP phases."
  });
}
