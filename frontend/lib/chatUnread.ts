"use client";

// The unread badge on the Team chat nav item.
//
// A chat nobody notices is a chat nobody uses: if the only way to learn that
// somebody posted is to open the page and look, the room goes quiet within a
// week. The badge is what makes it a chat rather than a noticeboard.
//
// ONE poll serves every subscriber. The sidebar and the mobile bar are both
// mounted at once, and a hook that polled per-component would double the
// traffic for a number that is the same in both places.

import { useEffect, useState } from "react";

import { api } from "@/lib/api";

let total = 0;
let timer: number | null = null;
const subscribers = new Set<(n: number) => void>();

async function pull(): Promise<void> {
  // A hidden tab costs nothing and learns nothing worth knowing.
  if (typeof document === "undefined" || document.visibilityState !== "visible") return;
  try {
    const rooms = await api.get<{ unread: number }[]>("/chat/rooms");
    const next = rooms.reduce((t, r) => t + (r.unread || 0), 0);
    if (next !== total) {
      total = next;
      subscribers.forEach((fn) => fn(total));
    }
  } catch {
    // A badge is never worth an error message. If chat is unreachable the page
    // the user actually asked for should still behave as though nothing is wrong.
  }
}

export function useChatUnread(): number {
  const [n, setN] = useState(total);

  useEffect(() => {
    subscribers.add(setN);
    void pull();
    if (timer === null) timer = window.setInterval(pull, 30_000);
    return () => {
      subscribers.delete(setN);
      if (subscribers.size === 0 && timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    };
  }, []);

  return n;
}

/** Recount now. The chat page calls this when a room is opened or a message is
 *  sent, so the badge drops immediately instead of up to thirty seconds later —
 *  a badge that lingers after you have read the message is worse than none. */
export function refreshChatUnread(): void {
  void pull();
}
