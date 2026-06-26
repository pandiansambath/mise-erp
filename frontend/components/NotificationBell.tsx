"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

type Notif = { id: string; kind: string; icon: string; title: string; body: string; route: string };

const SEEN_KEY = "mise.notif.seen";

function loadSeen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

export default function NotificationBell() {
  const router = useRouter();
  const [items, setItems] = useState<Notif[]>([]);
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const ref = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await api.get<{ items: Notif[] }>("/notifications");
      setItems(res.items || []);
    } catch {
      /* header must never break — ignore transient errors */
    }
  }, []);

  // Initial load + poll every 60s; seed "seen" from localStorage.
  useEffect(() => {
    setSeen(loadSeen());
    refresh();
    const t = setInterval(refresh, 60_000);
    return () => clearInterval(t);
  }, [refresh]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const unseen = items.filter((i) => !seen.has(i.id)).length;

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && items.length) {
      // opening = everything currently shown is now "seen"
      const all = new Set(seen);
      items.forEach((i) => all.add(i.id));
      setSeen(all);
      try {
        localStorage.setItem(SEEN_KEY, JSON.stringify([...all]));
      } catch {
        /* ignore */
      }
    }
  }

  function go(route: string) {
    setOpen(false);
    router.push(route);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Notifications"
        onClick={toggle}
        className="relative rounded-lg border border-glass/15 p-2 text-fg-soft transition hover:bg-glass/5"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unseen > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
            {unseen > 9 ? "9+" : unseen}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-glass/15 bg-shell/95 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center justify-between border-b border-glass/10 px-4 py-2.5">
            <span className="text-sm font-semibold text-fg">Notifications</span>
            <span className="text-xs text-fg-faint">{items.length} active</span>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-fg-faint">You&apos;re all caught up 🎉</p>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => go(n.route)}
                  className="flex w-full gap-3 border-b border-glass/5 px-4 py-3 text-left transition last:border-0 hover:bg-glass/5"
                >
                  <span className="text-lg leading-none">{n.icon}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-fg">{n.title}</span>
                    <span className="block text-xs text-fg-soft">{n.body}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
