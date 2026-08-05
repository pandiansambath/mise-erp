"use client";

// The key to the rota grid.
//
// Colour and position were both carrying meaning — a shift card, a leave strip,
// today's ring — and none of it was written down anywhere. A chart gets a
// legend; a screen that encodes information the same way needs one too.

export function RotaLegend() {
  const items: { chip: React.ReactNode; label: string; hint: string }[] = [
    {
      chip: (
        <span className="mise-well rounded-lg px-2 py-0.5 text-[10px] text-fg-soft">09:00–17:00</span>
      ),
      label: "Shift",
      hint: "drag onto another day to move it",
    },
    {
      chip: (
        <span className="rounded-lg border border-sky-400/25 bg-sky-400/[0.08] px-2 py-0.5 text-[10px] text-sky-300">
          🌴 name
        </span>
      ),
      label: "On approved leave",
      hint: "cannot be rota'd — booked here or on Attendance",
    },
    {
      chip: <span className="rounded-lg px-2 py-0.5 text-[10px] text-fg-faint ring-1 ring-brand-500/40">day</span>,
      label: "Today",
      hint: "the ringed column",
    },
    {
      chip: <span className="text-[10px] text-fg-faint">—</span>,
      label: "Nobody scheduled",
      hint: "no shifts on that day yet",
    },
  ];
  return (
    <div className="mise-well mb-3 rounded-xl p-3">
      <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-fg-faint">
        What you are looking at
      </p>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {items.map((it) => (
          <span key={it.label} className="flex items-center gap-2">
            {it.chip}
            <span className="text-[11px] leading-tight text-fg-soft">
              {it.label}
              <span className="block text-[10px] text-fg-faint">{it.hint}</span>
            </span>
          </span>
        ))}
      </div>
      <p className="mt-2.5 border-t border-line pt-2 text-[10px] leading-relaxed text-fg-faint">
        <b className="text-fg-soft">Rota and Attendance are the same fact seen twice.</b> Book
        leave on either page and both obey it: the rota stops scheduling that person, and the
        attendance sheet stops reading them as absent.
      </p>
    </div>
  );
}
