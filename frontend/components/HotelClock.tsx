"use client";

import { useEffect, useState } from "react";

import { useAuth } from "@/lib/auth";

/**
 * The time, in the restaurant's own timezone, on every page.
 *
 *   "i want a time to be running in corner of our site — in all the pages
 *    literally... HH:MM:SS, hour minute and seconds of that particular hotel's
 *    timezone that they selected"
 *
 * THE HOTEL'S ZONE, NOT THE DEVICE'S, and that distinction is the whole reason
 * this is worth having. A manager checking the London kitchen from a phone in
 * India is looking at a page where "today" already means London — the sales
 * day, the rota, the attendance cut-off all use `hotel.timezone`. A clock
 * showing the tablet's own idea of the time would quietly disagree with every
 * number beside it.
 *
 * It ticks on a one-second interval and renders `--:--:--` until it has
 * mounted, because the server has no clock the browser will agree with and a
 * hydration mismatch on a component that is on EVERY page is not worth a
 * cosmetic second.
 */
export function HotelClock({ className = "" }: { className?: string }) {
  const { hotel } = useAuth();
  const zone = hotel?.timezone || undefined;
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const time = now
    ? new Intl.DateTimeFormat("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        timeZone: zone,
      }).format(now)
    : "--:--:--";

  // Only worth saying WHERE when it is not where you are — otherwise it is
  // noise on every page of the app.
  const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const elsewhere = Boolean(zone && zone !== deviceZone);

  return (
    <span
      className={`inline-flex items-center gap-1.5 tabular-nums ${className}`}
      title={
        elsewhere
          ? `${hotel?.name ?? "This restaurant"} runs on ${zone} — your device is on ${deviceZone}`
          : `${hotel?.name ?? "This restaurant"}'s local time`
      }
      aria-label={`Restaurant time ${time}${elsewhere ? `, ${zone}` : ""}`}
    >
      <span aria-hidden className="text-[10px] leading-none opacity-70">
        🕐
      </span>
      <span className="font-mono text-xs font-medium">{time}</span>
      {elsewhere && (
        <span className="hidden text-[10px] text-fg-faint sm:inline">
          {zone?.split("/").pop()?.replace(/_/g, " ")}
        </span>
      )}
    </span>
  );
}
