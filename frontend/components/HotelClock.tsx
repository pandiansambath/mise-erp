"use client";

import { useEffect, useState } from "react";

import Link from "next/link";

import { AnalogClock, type ClockFace } from "@/components/AnalogClock";
import { SheetPopup } from "@/components/SheetPopup";
import { useAuth } from "@/lib/auth";

/** Faces worth offering. Twelve exist; these are the ones that read at a glance
 *  across a kitchen, which is the only place this clock is ever looked at. */
const FACES: { key: ClockFace; label: string }[] = [
  { key: "classic", label: "Classic" },
  { key: "minimal", label: "Minimal" },
  { key: "roman", label: "Roman" },
  { key: "braun", label: "Braun" },
  { key: "railway", label: "Railway" },
  { key: "bauhaus", label: "Bauhaus" },
  { key: "skeleton", label: "Skeleton" },
  { key: "regulator", label: "Regulator" },
];

/** Remembered per browser: a face and a format are a preference, not data, and
 *  they should survive a reload without troubling the server. */
function remembered<T extends string>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    return (window.localStorage.getItem(key) as T) || fallback;
  } catch {
    return fallback;
  }
}

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
  const [open, setOpen] = useState(false);
  const [face, setFace] = useState<ClockFace>(() => remembered<ClockFace>("mise.clock.face", "classic"));
  const [hour12, setHour12] = useState(() => remembered<string>("mise.clock.h12", "0") === "1");

  useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // `hour12` is in the dependency list implicitly by being read during render;
  // the interval only replaces `now`, so a format change repaints on the next
  // tick at the latest and immediately via the state update that set it.
  const time = now
    ? new Intl.DateTimeFormat("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        // HIS CHOICE, not a constant. The popup let him pick 12-hour and the
        // header carried on showing 24 — the setting appeared to do nothing,
        // which is worse than not offering it.
        hour12,
        timeZone: zone,
      }).format(now)
    : "--:--:--";

  // Only worth saying WHERE when it is not where you are — otherwise it is
  // noise on every page of the app.
  const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const elsewhere = Boolean(zone && zone !== deviceZone);

  return (
    <>
    <button
      type="button"
      onClick={() => setOpen(true)}
      className={`mise-press inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 tabular-nums transition hover:bg-glass/10 ${className}`}
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
    </button>

    {/* THE REAL CLOCK, on tap.
        "that needs to be a clickable one — once clicked it needs to open a
         glassmorphic kinda popup and show real traditional clock running live,
         also with some customisation like changing the format 24 or 12, also
         clock faces too."

        The faces already existed for the kiosk wall display; nothing new had to
        be drawn, they just had nowhere to be chosen from. Face and format are
        remembered per browser — a preference, not data, and not worth troubling
        the server for. */}
    {open && (
      <SheetPopup
        onClose={() => setOpen(false)}
        title={hotel?.name ? `${hotel.name} — local time` : "Local time"}
        subtitle={elsewhere ? `${zone} · your device is on ${deviceZone}` : zone}
      >
        {/* IT MUST FIT.
            First attempt asked for a two-column popup and a 230px dial, then a
            digital readout, a date, a format switch and eight face buttons. The
            stack was taller than the popup could be, so it centred itself with
            its head off the top of the screen and its FACE row hanging out of
            the bottom of its own box.

            Everything here is sized so the whole thing fits on a phone without
            scrolling: a smaller dial, tighter gaps, and the faces in two rows
            of four. A popup you have to scroll to see a clock in is not worth
            opening. */}
        <div className="flex flex-col items-center gap-3">
          <AnalogClock size={172} tz={zone} face={face} numerals={hour12} digital={false} />
          <p className="font-mono text-xl font-semibold tabular-nums text-fg">
            {now
              ? new Intl.DateTimeFormat("en-GB", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                  hour12,
                  timeZone: zone,
                }).format(now)
              : "--:--:--"}
          </p>
          <p className="text-xs text-fg-faint">
            {now
              ? new Intl.DateTimeFormat("en-GB", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  timeZone: zone,
                }).format(now)
              : ""}
          </p>

          <div className="mise-well flex gap-1 rounded-xl p-1">
            {([
              [false, "24-hour"],
              [true, "12-hour"],
            ] as const).map(([v, label]) => (
              <button
                key={label}
                type="button"
                onClick={() => {
                  setHour12(v);
                  try {
                    window.localStorage.setItem("mise.clock.h12", v ? "1" : "0");
                  } catch {
                    /* a browser refusing storage must not break the clock */
                  }
                }}
                className={`mise-press rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  hour12 === v ? "bg-brand-600 text-white" : "text-fg-soft hover:text-fg"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Where the zone is actually changed. The popup names the zone and
              then left him to go and find the setting — the same dead end the
              login popup had. */}
          <Link
            href="/settings#timezone"
            onClick={() => setOpen(false)}
            className="mise-press inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[11px] font-medium text-fg-soft hover:border-brand-400/50 hover:text-brand-300"
          >
            Change the restaurant&apos;s timezone
            <span aria-hidden>→</span>
          </Link>

          <div className="w-full">
            <p className="mb-1.5 text-center text-[10px] uppercase tracking-wide text-fg-faint">
              Face
            </p>
            <div className="grid grid-cols-4 gap-1">
              {FACES.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => {
                    setFace(f.key);
                    try {
                      window.localStorage.setItem("mise.clock.face", f.key);
                    } catch {
                      /* ignore */
                    }
                  }}
                  className={`mise-press rounded-lg px-2 py-1.5 text-[11px] font-medium transition ${
                    face === f.key
                      ? "bg-brand-600 text-white"
                      : "mise-card-inset text-fg-soft hover:text-fg"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </SheetPopup>
    )}
    </>
  );
}
