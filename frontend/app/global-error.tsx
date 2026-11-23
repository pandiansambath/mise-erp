"use client";

// The last resort, for every page of both sites: an error nothing nearer
// caught. Its usual cause is a page that was open across a deploy and asked for
// code the new build no longer has: then the page comes afresh by itself, once
// (§103.1). Otherwise the same two choices the framework offers.

import { useEffect } from "react";
import { freshPage, isMissingCode } from "@/dev/chunks";

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    if (isMissingCode(error)) freshPage();
  }, [error]);
  const button = { borderRadius: 8, padding: "9px 16px", fontSize: 14, cursor: "pointer", border: "1px solid #8886", background: "transparent", color: "inherit" } as const;
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100dvh", display: "grid", placeItems: "center", fontFamily: "system-ui, sans-serif", background: "#fbfaf8", color: "#16181d" }}>
        <main style={{ padding: 24, maxWidth: 420 }}>
          <h1 style={{ fontSize: 22, margin: 0 }}>This page couldn’t load</h1>
          <p style={{ fontSize: 14, color: "#59606b", margin: "10px 0 18px" }}>Reload to try again, or go back.</p>
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" style={{ ...button, background: "#16181d", color: "#fff" }} onClick={() => window.location.reload()}>
              Reload
            </button>
            <button type="button" style={button} onClick={() => window.history.back()}>
              Back
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
