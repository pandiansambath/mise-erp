"use client";

// The attendance tablet.
//
// A screen on the wall by the door. Staff walk up, find their name, tap it,
// and walk away. It is the only thing this login can reach.
//
// Everything here is shaped by the fact that it is a SHARED, UNATTENDED
// screen in a working kitchen:
//
// **Big targets, no chrome.** No sidebar, no menus, no settings — nothing to
// wander into. Tiles are large because they are tapped by people carrying
// things, sometimes with wet hands.
//
// **It says what happened and then forgets.** A confirmation shows for a few
// seconds and clears itself, so the next person does not walk up to somebody
// else's name still highlighted on the screen.
//
// **It shows no money.** Not wages, not sales, not hours totalled into pay.
// The permission set makes that true; the design does not tempt anyone to
// widen it.

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, clearToken, type AttendanceRow, type Employee } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { AnalogClock, type ClockFace } from "@/components/AnalogClock";
import { KioskMenu } from "@/components/KioskMenu";
import { KioskGate } from "@/components/KioskGate";
import { KioskPanel } from "@/components/KioskPanels";
import { KioskQuote } from "@/components/KioskQuote";
import { useHotelTime } from "@/lib/time";
import { THEMES, themeVars, type ThemeKey } from "@/lib/theme";

const today = () => new Date().toISOString().slice(0, 10);

export default function KioskPage() {
  const { user, hotel, loading } = useAuth();
  const { time: fmtTime } = useHotelTime();
  const [staff, setStaff] = useState<Employee[]>([]);
  const [rows, setRows] = useState<Record<string, AttendanceRow>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ name: string; what: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [clockSize, setClockSize] = useState(236);
  useEffect(() => {
    const fit = () => setClockSize(window.innerWidth < 640 ? 168 : 236);
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  const [leaving, setLeaving] = useState(false);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  // Which extra panel is open, and whether the owner allowed them at all.
  const [panel, setPanel] = useState<"rota" | "leave" | null>(null);
  const [allowed, setAllowed] = useState<{ rota: boolean; leave: boolean }>({ rota: false, leave: false });
  // What this screen looks like.
  //
  // The hotel's choice arrives from the server, because the tablet is a
  // different browser from the owner's and a theme in localStorage would never
  // reach it. Anyone standing AT the screen can override it for this device —
  // the light in a kitchen is not the light the owner picked it under.
  const [theme, setTheme] = useState<ThemeKey>("dark");
  const [menuOpen, setMenuOpen] = useState(false);
  // How the clock reads, per device. A tablet on a bright wall and one in a
  // dim corridor want different faces, and neither should have to argue with
  // the other about it.
  const [face, setFace] = useState<ClockFace>("classic");
  const [numerals, setNumerals] = useState(false);
  const [digital, setDigital] = useState(true);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("mise.kiosk.clock");
      if (raw) {
        const c = JSON.parse(raw) as { face?: ClockFace; numerals?: boolean; digital?: boolean };
        if (c.face) setFace(c.face);
        if (typeof c.numerals === "boolean") setNumerals(c.numerals);
        if (typeof c.digital === "boolean") setDigital(c.digital);
      }
    } catch {
      /* private mode — the defaults are fine */
    }
  }, []);
  const saveClock = (next: Partial<{ face: ClockFace; numerals: boolean; digital: boolean }>) => {
    const merged = { face, numerals, digital, ...next };
    if (next.face !== undefined) setFace(next.face);
    if (next.numerals !== undefined) setNumerals(next.numerals);
    if (next.digital !== undefined) setDigital(next.digital);
    try {
      localStorage.setItem("mise.kiosk.clock", JSON.stringify(merged));
    } catch {
      /* nothing to do */
    }
  };
  useEffect(() => {
    try {
      const local = localStorage.getItem("mise.kiosk.theme") as ThemeKey | null;
      if (local && local in THEMES) setTheme(local);
    } catch {
      /* private mode — the hotel's choice still applies */
    }
  }, []);
  const pickTheme = (k: ThemeKey) => {
    setTheme(k);
    setMenuOpen(false);
    try {
      localStorage.setItem("mise.kiosk.theme", k);
    } catch {
      /* nothing to do */
    }
  };

  useEffect(() => {
    if (loading || !user) return;
    api
      .get<{ show_rota?: boolean; show_leave?: boolean; theme?: string }>("/attendance/lock")
      .then((r) => {
        setAllowed({ rota: !!r.show_rota, leave: !!r.show_leave });
        // Only if this device has not been given one of its own.
        let local: string | null = null;
        try {
          local = localStorage.getItem("mise.kiosk.theme");
        } catch {
          /* ignore */
        }
        // The server already applies the precedence (kiosk → hotel → dark),
        // so whatever it says is the answer. Second-guessing it here is how
        // the two ended up disagreeing.
        const wanted = r.theme && r.theme in THEMES ? r.theme : hotel?.theme;
        if (!local && wanted && wanted in THEMES) {
          setTheme(wanted as ThemeKey);
          // Remember it for the GATE, which runs before anyone is signed in
          // and so has no other way to learn what this restaurant looks like.
          try {
            localStorage.setItem("mise.kiosk.theme", wanted);
          } catch {
            /* nothing to do */
          }
        }
      })
      .catch(() => {});
  }, [loading, user, hotel]);

  async function leave() {
    setPinError(null);
    try {
      const r = await api.post<{ ok: boolean }>("/attendance/lock/verify", { pin });
      if (!r.ok) {
        setPinError("That PIN is not right.");
        return;
      }
      // The tab is holding an attendance-only token; ending it leaves nothing
      // behind for the next person who picks the tablet up.
      clearToken();
      // Back to the admin app on the same address — they came from there.
      window.location.assign("/dashboard");
    } catch {
      setPinError("Could not check the PIN.");
    }
  }

  // A clock people can read from across the room is half of why a device like
  // this earns its place on the wall.
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    try {
      const [people, attendance] = await Promise.all([
        api.get<Employee[]>("/employees"),
        api.get<AttendanceRow[]>(`/attendance?on=${today()}`),
      ]);
      setStaff(people.filter((p) => p.is_active));
      setRows(Object.fromEntries(attendance.map((r) => [r.employee_id, r])));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach DineAI.");
    }
  }, []);

  useEffect(() => {
    if (loading || !user) return;
    load();
    // Somebody else may clock in from the office. A quiet refresh keeps the
    // wall screen honest without anyone touching it.
    const t = window.setInterval(load, 30_000);
    return () => window.clearInterval(t);
  }, [loading, user, load]);

  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), 4000);
    return () => window.clearTimeout(t);
  }, [flash]);

  const onCount = staff.filter((e) => rows[e.id]?.clock_in && !rows[e.id]?.clock_out && !rows[e.id]?.on_break).length;
  const breakCount = staff.filter((e) => rows[e.id]?.on_break).length;
  const doneCount = staff.filter((e) => rows[e.id]?.clock_out).length;

  async function punch(emp: Employee, action: string, label: string) {
    setBusy(emp.id);
    setError(null);
    try {
      await api.post("/attendance/punch", { employee_id: emp.id, type: action });
      setFlash({ name: emp.full_name, what: label });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That did not go through.");
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div
        className="grid min-h-dvh place-items-center bg-shell text-fg-faint"
        style={themeVars("dark")}
      >
        …
      </div>
    );
  }

  // A cold tablet on the wall: no session, so ask for the PIN rather than
  // sending somebody to a login page they have no credentials for.
  if (!user) {
    return <KioskGate onOpen={() => window.location.reload()} />;
  }

  return (
    // The palette is pinned here, not inherited.
    //
    // ThemeProvider writes the account's colours onto :root, so a manager who
    // picks a light theme was silently restyling the wall tablet too — and
    // this screen is built for dark. The result was the washed-out screen he
    // photographed, with "1 in now" and "Start break" barely visible.
    //
    // Custom properties inherit, so declaring them HERE overrides the root for
    // everything inside, whatever the account chose. It reuses the real theme
    // rather than duplicating hexes that would drift.
    <div
      className="mise-app min-h-dvh bg-shell text-fg"
      // Follows the hotel now, not a hard-coded dark. `data-mode` still has to
      // travel with it — the light-theme legibility rules in globals.css key
      // off that attribute, and it is what stops a pale palette turning the
      // accent text into something nobody can read. That was the original
      // washed-out bug, and it is only avoided by keeping the two in step.
      data-mode={THEMES[theme].light ? "light" : "dark"}
      style={themeVars(theme)}
    >
      {/* Light in the room. Two slow blooms behind everything, so a screen
          that lives on a wall for twelve hours a day looks alive rather than
          like a form somebody left open. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        <span
          className="absolute -left-40 -top-40 h-[38rem] w-[38rem] rounded-full opacity-25 blur-[120px]"
          style={{ background: "radial-gradient(circle, var(--color-brand-500), transparent 68%)" }}
        />
        <span
          className="absolute -bottom-48 -right-32 h-[34rem] w-[34rem] rounded-full opacity-20 blur-[120px]"
          style={{ background: "radial-gradient(circle, #38bdf8, transparent 70%)" }}
        />
      </div>

      {/* Top-aligned, and stacked on a phone.
          `items-end` sank the short name block against a 236px clock and left
          a hole above it; centring only moved the hole. The date and the name
          are the first thing anybody reads, so they start at the top and the
          clock hangs beside them. */}
      <header className="relative flex flex-col items-center gap-4 px-5 pb-5 pt-6 text-center sm:flex-row sm:items-start sm:justify-between sm:px-8 sm:pb-6 sm:pt-8 sm:text-left">
        <div className="min-w-0">
          <p className="font-mono text-[11px] uppercase tracking-[0.35em] text-fg-faint">
            {now.toLocaleDateString(undefined, {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </p>
          <h1 className="mt-1 truncate font-display text-3xl font-semibold tracking-tight">
            {hotel?.name ?? "Attendance"}
          </h1>
          <p className="mt-1 text-sm text-fg-faint">Tap your name to clock in or out</p>
          {/* The band beside the clock had nothing in it, on a screen dozens of
              people read dozens of times a shift. That is a rare amount of
              attention to be spending on blank space. */}
          <KioskQuote />
        </div>
        {/* A real clock face, hands sweeping, digits in the middle. It says
            the time AND that the screen is alive, from across the room,
            without anybody reading it. */}
        <div className="flex shrink-0 flex-col items-center">
          {/* Smaller on a phone: at 236px the clock pushed the names — the one
              thing anybody opens this screen to tap — below the fold. */}
          <AnalogClock
            size={clockSize}
            tz={hotel?.timezone}
            face={face}
            numerals={numerals}
            digital={digital}
            onToggleNumerals={() => saveClock({ numerals: !numerals })}
          />
          {/* Which clock this is. A wall screen that disagrees with the phone
              in your pocket starts an argument about hours, and the answer is
              always "whose timezone?" — so it says so up front. */}
          <p className="mt-1 font-mono text-[10px] tracking-[0.22em] text-fg-faint">
            {(hotel?.timezone ?? "").replace("_", " ")}
          </p>
        </div>
      </header>

      {/* How the shift is going, in one line. */}
      <div className="relative flex flex-wrap items-center gap-2 px-5 pb-2 sm:px-8">
        {[
          { n: onCount, label: "in now", cls: "border-brand-400/40 bg-brand-400/10 text-brand-200" },
          { n: breakCount, label: "on break", cls: "border-amber-400/40 bg-amber-400/10 text-amber-200" },
          { n: doneCount, label: "finished", cls: "border-line bg-glass/5 text-fg-faint" },
        ].map((x) => (
          <span
            key={x.label}
            className={`rounded-full border px-3.5 py-1.5 text-sm font-medium ${x.cls}`}
          >
            <b className="tabular-nums">{x.n}</b> {x.label}
          </span>
        ))}

        {/* One ⋮ instead of a growing row of loose buttons.
            Four or five controls along a counter row stop reading as "things
            you can do" and start reading as clutter, on a screen whose whole
            job is a list of names. */}
        <div className="relative ml-auto">
          <KioskMenu
            open={menuOpen}
            onOpen={() => setMenuOpen(true)}
            onClose={() => setMenuOpen(false)}
            theme={theme}
            onTheme={pickTheme}
            face={face}
            onFace={(f) => saveClock({ face: f })}
            numerals={numerals}
            onNumerals={(v) => saveClock({ numerals: v })}
            digital={digital}
            onDigital={(v) => saveClock({ digital: v })}
            showRota={allowed.rota}
            showLeave={allowed.leave}
            onRota={() => setPanel("rota")}
            onLeave={() => setPanel("leave")}
          />
        </div>
      </div>

      {panel && (
        <KioskPanel
          kind={panel}
          names={Object.fromEntries(staff.map((e) => [e.id, e.full_name]))}
          onClose={() => setPanel(null)}
        />
      )}

      {/* One line, large, then gone. The next person up should not be looking
          at somebody else's confirmation. */}
      {/* The moment.
          A tap on a shared screen deserves an unmistakable answer — you should
          know it worked from across the room, without leaning in to read a
          small green line. It fills the screen, says the name, and clears
          itself so the next person never sees somebody else's. */}
      {flash && (
        <div
          className="mise-pop fixed inset-0 z-50 grid place-items-center bg-shell/92 backdrop-blur-md"
          onClick={() => setFlash(null)}
        >
          <div className="px-8 text-center">
            <span
              aria-hidden
              className="mx-auto grid h-24 w-24 place-items-center rounded-full bg-brand-500/15 text-5xl"
              style={{ animation: "mise-pop .45s cubic-bezier(.16,1,.3,1) both" }}
            >
              ✓
            </span>
            <p className="mt-6 font-display text-5xl font-semibold tracking-tight sm:text-6xl">
              {flash.name}
            </p>
            <p className="mt-2 text-xl text-brand-300">{flash.what}</p>
            <p className="mt-6 font-mono text-sm tabular-nums text-fg-faint">
              {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </p>
          </div>
        </div>
      )}
      {error && (
        <p className="mx-6 mt-4 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-5 py-3 text-center text-sm text-rose-200">
          {error}
        </p>
      )}

      <main className="relative grid grid-cols-2 gap-4 px-8 pb-10 pt-4 sm:grid-cols-3 lg:grid-cols-4">
        {staff.length === 0 && (
          <p className="col-span-full py-16 text-center text-sm text-fg-faint">
            No active staff yet.
          </p>
        )}
        {staff.map((emp) => {
          const r = rows[emp.id];
          const inNow = !!r?.clock_in && !r?.clock_out;
          const onBreak = !!r?.on_break;
          const done = !!r?.clock_out;
          return (
            <div
              key={emp.id}
              className={`relative overflow-hidden rounded-3xl border p-5 backdrop-blur-sm transition duration-300 ${
                onBreak
                  ? "border-amber-400/40 bg-amber-400/[0.10]"
                  : inNow
                    ? "border-brand-400/45 bg-brand-400/[0.10] shadow-lg shadow-brand-900/20"
                    : done
                      ? "border-line bg-glass/[0.03] opacity-60"
                      : "border-line bg-glass/[0.06]"
              }`}
            >
              {/* A pulse on anyone currently working — the room can see at a
                  glance who is on the floor. */}
              {inNow && !onBreak && (
                <span
                  aria-hidden
                  className="absolute right-4 top-4 h-2.5 w-2.5 rounded-full bg-brand-400"
                  style={{ animation: "mise-pulse 2s ease-in-out infinite" }}
                />
              )}
              <span
                aria-hidden
                className={`mb-3 grid h-14 w-14 place-items-center rounded-2xl font-display text-xl font-bold ${
                  inNow || onBreak ? "bg-glass/15 text-fg" : "bg-glass/[0.08] text-fg-soft"
                }`}
              >
                {emp.full_name
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((w) => w[0]?.toUpperCase())
                  .join("")}
              </span>
              <p className="truncate font-display text-lg font-semibold">{emp.full_name}</p>
              <p className="mt-0.5 text-[11px] text-fg-faint">
                {done
                  ? `finished ${fmtTime(r?.clock_out ?? null)}`
                  : onBreak
                    ? "on break"
                    : inNow
                      ? `in since ${fmtTime(r?.clock_in ?? null)}`
                      : "not in yet"}
              </p>

              {/* One obvious action, sized for a thumb. Anything cleverer is a
                  thing to get wrong while somebody waits behind you. */}
              <div className="mt-3 grid gap-2">
                {!inNow && !onBreak && !done && (
                  <button
                    type="button"
                    disabled={busy === emp.id}
                    onClick={() => punch(emp, "CLOCK_IN", "clocked in")}
                    className="mise-press rounded-2xl bg-brand-600 py-4 text-base font-semibold text-[color:var(--color-brand-50,#fff)] transition hover:bg-brand-500 disabled:opacity-50"
                  >
                    Clock in
                  </button>
                )}
                {inNow && !onBreak && (
                  <>
                    <button
                      type="button"
                      disabled={busy === emp.id}
                      onClick={() => punch(emp, "BREAK_START", "on break")}
                      className="mise-press rounded-2xl border border-amber-400/40 bg-amber-400/10 py-3 text-base font-medium text-amber-200 disabled:opacity-50"
                    >
                      Start break
                    </button>
                    <button
                      type="button"
                      disabled={busy === emp.id}
                      onClick={() => punch(emp, "CLOCK_OUT", "clocked out")}
                      className="mise-press rounded-2xl border border-line-2 py-3 text-base font-medium text-fg-soft disabled:opacity-50"
                    >
                      Clock out
                    </button>
                  </>
                )}
                {onBreak && (
                  <button
                    type="button"
                    disabled={busy === emp.id}
                    onClick={() => punch(emp, "BREAK_END", "back from break")}
                    className="mise-press rounded-2xl bg-brand-600 py-4 text-base font-semibold text-[color:var(--color-brand-50,#fff)] transition hover:bg-brand-500 disabled:opacity-50"
                  >
                    End break
                  </button>
                )}
                {done && (
                  <p className="py-2 text-center text-xs text-fg-faint">done for today</p>
                )}
              </div>
            </div>
          );
        })}
      </main>

      {/* Deliberately small and at the very bottom. Signing the tablet out is
          something a manager does at closing, not something anyone should find
          by accident mid-service. */}
      <footer className="relative border-t border-line px-8 py-5 text-center">
        <button
          type="button"
          onClick={() => setLeaving(true)}
          className="text-[11px] text-fg-faint underline-offset-4 hover:underline"
        >
          Leave · back to DineAI
        </button>
      </footer>

      {/* Leaving needs the PIN too. A lock that only holds one way is a door
          that opens from the outside. */}
      {leaving && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-shell/92 p-6 backdrop-blur-md">
          <div className="mise-pop w-full max-w-sm rounded-3xl border border-line bg-paper-2 p-6 text-center">
            <p className="text-3xl" aria-hidden>🔒</p>
            <h2 className="mt-3 font-display text-xl font-semibold">Enter the PIN to leave</h2>
            <p className="mt-1 text-xs text-fg-faint">
              This screen stays locked to attendance until somebody types it.
            </p>
            <input
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
              inputMode="numeric"
              autoFocus
              // Six, matching the length DineAI generates. The field always
              // accepted eight — it was the placeholder that said "four", which
              // is the same misleading cue the keypad had.
              placeholder="••••••"
              className="mise-well mt-4 w-full rounded-2xl px-4 py-3 text-center font-mono text-2xl tracking-[0.4em] outline-none"
            />
            {pinError && <p className="mt-2 text-sm text-rose-400">{pinError}</p>}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={leave}
                disabled={pin.length < 4}
                className="mise-press flex-1 rounded-2xl bg-brand-600 py-3 font-semibold text-[color:var(--color-brand-50,#fff)] disabled:opacity-40"
              >
                Unlock
              </button>
              <button
                type="button"
                onClick={() => { setLeaving(false); setPin(""); setPinError(null); }}
                className="mise-press rounded-2xl border border-line px-5 py-3 text-fg-soft"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
