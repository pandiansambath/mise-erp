"use client";

// Subscribe to the backend's Server-Sent Events stream and run a callback when
// an event of the given type arrives — so pages update live (no manual reload).
import { useEffect, useRef } from "react";
import { API_BASE, getToken } from "@/lib/api";

export function useLiveRefresh(eventType: string, onEvent: () => void) {
  const cb = useRef(onEvent);
  useEffect(() => {
    cb.current = onEvent;
  });

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    const es = new EventSource(
      `${API_BASE}/api/events/stream?token=${encodeURIComponent(token)}`
    );
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data?.type === eventType) cb.current();
      } catch {
        /* ignore keepalive / malformed frames */
      }
    };
    // EventSource auto-reconnects on error; nothing to do here.
    return () => es.close();
  }, [eventType]);
}
