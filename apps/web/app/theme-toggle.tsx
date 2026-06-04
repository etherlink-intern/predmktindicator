"use client";

import { useState, useEffect } from "react";

export function ThemeToggle() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const toggle = () => {
    const html = document.documentElement;
    const current = html.getAttribute("data-theme");
    const next = current === "dark" ? "light" : "dark";
    html.setAttribute("data-theme", next);
    try { localStorage.setItem("fx-theme", next); } catch {}
  };

  if (!mounted) return <div style={{ width: 68 }} />;

  const isDark = document.documentElement.getAttribute("data-theme") === "dark";

  return (
    <button className="theme-toggle" onClick={toggle} aria-label="Toggle theme">
      {isDark ? "☀️" : "🌙"}
    </button>
  );
}
