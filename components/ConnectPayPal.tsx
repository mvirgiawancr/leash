"use client";

import { useState } from "react";

export function ConnectPayPal() {
  const [state, setState] = useState<"idle" | "going" | "error">("idle");
  return (
    <div className="connect">
      <button
        className="btn big"
        disabled={state === "going"}
        onClick={async () => {
          setState("going");
          try {
            const r = await fetch("/api/vault/setup", { method: "POST" });
            const j = await r.json();
            if (!r.ok || !j.approveUrl) throw new Error();
            window.location.href = j.approveUrl;
          } catch {
            setState("error");
          }
        }}
      >
        {state === "going" ? "Opening PayPal…" : "Connect PayPal wallet"}
        <span aria-hidden>→</span>
      </button>
      <p className="connect-note">
        {state === "error"
          ? "PayPal didn’t answer. Try again in a moment."
          : "Sandbox only. You approve once on PayPal; no money moves until you sign a mandate."}
      </p>
    </div>
  );
}
