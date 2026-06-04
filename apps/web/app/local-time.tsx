"use client";

import { useState, useEffect } from "react";

export function LocalTime({ date, fallback }: { date: string | null; fallback?: string }) {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    if (!date) {
      setText(null);
      return;
    }
    setText(
      new Date(date).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    );
  }, [date]);

  if (text === null) return <>{fallback ?? "No snapshot yet"}</>;
  return <>{text}</>;
}
