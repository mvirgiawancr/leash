"use client";

import { useRef, useState } from "react";
import type { Errand, ErrandEvent, Mandate, Wallet } from "@/lib/types";
import { Bar } from "./Bar";
import { ErrandView } from "./ErrandView";
import { ParcelTag } from "./ParcelTag";
import { Tape } from "./Tape";

const SUGGESTIONS = ["A USB-C hub for two monitors", "Replace my worn-out keyboard", "A cheap laptop stand", "Buy me a standing desk"];

type Busy = { id: string; what: "approve" | "decline" | "refund" } | null;

export function DeskClient(props: { errands: Errand[]; mandate: Mandate; wallet: Wallet; month: string }) {
  const [errands, setErrands] = useState(props.errands);
  const [mandate, setMandate] = useState(props.mandate);
  const [ask, setAsk] = useState("");
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [freshAfter] = useState(() => new Date().toISOString());
  const box = useRef<HTMLTextAreaElement>(null);

  const patch = (id: string, f: (e: Errand) => Errand) => setErrands((list) => list.map((e) => (e.id === id ? f(e) : e)));

  async function send(text: string) {
    const q = text.trim();
    if (!q || sending) return;
    setSending(true);
    setError(null);
    let id = "";
    try {
      const res = await fetch("/api/errands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ask: q }),
      });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => null))?.error ?? "Leash couldn’t start.");
      setAsk("");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line) as ErrandEvent;
          if (ev.type === "start") {
            id = ev.errand.id;
            setErrands((list) => [ev.errand, ...list]);
          } else if (ev.type === "tape") patch(id, (e) => ({ ...e, tape: [...e.tape, ev.line] }));
          else if (ev.type === "options") patch(id, (e) => ({ ...e, options: ev.options }));
          else if (ev.type === "found") patch(id, (e) => ({ ...e, found: ev.found }));
          else if (ev.type === "status") patch(id, (e) => ({ ...e, status: ev.status, approval: ev.approval ?? e.approval }));
          else if (ev.type === "done") {
            patch(id, () => ev.errand);
            setMandate(ev.mandate);
          } else if (ev.type === "error") setError(ev.message);
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function act(e: Errand, what: "approve" | "decline" | "refund") {
    setBusy({ id: e.id, what });
    setError(null);
    try {
      const url = what === "refund" ? `/api/purchases/${e.purchaseId}/refund` : `/api/errands/${e.id}/${what}`;
      const res = await fetch(url, { method: "POST" });
      const j = await res.json();
      if (j.errand) patch(e.id, () => j.errand);
      if (j.mandate) setMandate(j.mandate);
      if (!res.ok) setError(j.error ?? "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
    <Bar mandate={mandate} wallet={props.wallet} />
    <main className="desk">
      <section className="work">
        <form
          className="composer"
          onSubmit={(ev) => {
            ev.preventDefault();
            send(ask);
          }}
        >
          <label htmlFor="ask">Send Leash on an errand</label>
          <textarea
            id="ask"
            ref={box}
            rows={2}
            value={ask}
            disabled={sending}
            onChange={(ev) => setAsk(ev.target.value)}
            onKeyDown={(ev) => {
              if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) {
                ev.preventDefault();
                send(ask);
              }
            }}
            placeholder="A webcam that doesn’t make me look like a potato on calls"
          />
          <div className="composer-foot">
            <div className="suggest">
              {SUGGESTIONS.map((s) => (
                <button
                  type="button"
                  key={s}
                  disabled={sending}
                  onClick={() => {
                    setAsk(s);
                    box.current?.focus();
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
            <button className="btn" type="submit" disabled={sending || ask.trim().length < 3}>
              {sending ? "Leash is on it…" : "Send errand"} <kbd>Ctrl ↵</kbd>
            </button>
          </div>
        </form>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <div className="feed">
          {errands.length === 0 && (
            <div className="empty-feed">
              <p>No errands yet. Ask for something your mandate covers, and something it doesn’t, and watch the tape.</p>
            </div>
          )}
          {errands.map((e) => (
            <ErrandView
              key={e.id}
              errand={e}
              mandate={mandate}
              busy={busy?.id === e.id ? busy.what : null}
              onApprove={() => act(e, "approve")}
              onDecline={() => act(e, "decline")}
              onRefund={() => act(e, "refund")}
            />
          ))}
        </div>
      </section>

      <aside className="tape-col" aria-label="Ledger">
        <div className="tape-sticky">
          <ParcelTag errands={errands} shipTo={props.wallet.shipTo} />
          <Tape errands={errands} mandate={mandate} freshAfter={freshAfter} month={props.month} />
        </div>
      </aside>
    </main>
    </>
  );
}
