"use client";

import { useEffect } from "react";
import { reportError } from "@/lib/error-reporter";

export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportError(error.message, { stack: error.stack, context: { digest: error.digest } });
  }, [error]);

  return (
    <div style={{ fontFamily: "sans-serif", padding: "2rem", textAlign: "center" }}>
      <h2>Something went wrong</h2>
      <button onClick={reset} style={{ marginTop: "1rem", padding: "0.5rem 1rem", cursor: "pointer" }}>
        Try again
      </button>
    </div>
  );
}
