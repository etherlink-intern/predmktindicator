"use client";

import { useState, useEffect } from "react";

function timeAgo(generatedAt: string | null): string {
  if (!generatedAt) return "Never";
  const now = Date.now();
  const then = new Date(generatedAt).getTime();
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 5) return "Just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m ago`;
}

export function LastRefreshedCounter({ generatedAt }: { generatedAt: string | null }) {
  const [label, setLabel] = useState(() => timeAgo(generatedAt));

  useEffect(() => {
    setLabel(timeAgo(generatedAt));
    const interval = setInterval(() => setLabel(timeAgo(generatedAt)), 10_000);
    return () => clearInterval(interval);
  }, [generatedAt]);

  return <span style={{ color: "var(--muted)", fontSize: "12px" }}>Data refreshed {label}</span>;
}
