"use client";

/** One dish on a ticket, ticked off with a tap. The whole row is the target:
 *  this gets pressed with a wet thumb, not aimed at. A tick and a line through
 *  the name, so a done dish does not rely on colour either. */
export function TickItem({
  item,
  big = false,
  onToggle,
}: {
  item: { name: string; quantity: number; done: boolean };
  big?: boolean;
  onToggle: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        aria-pressed={item.done}
        onClick={onToggle}
        className={`mise-press flex w-full items-center gap-2 rounded-lg py-1 text-left ${big ? "text-lg" : "text-sm"}`}
      >
        <span
          aria-hidden
          className={`grid h-6 w-6 shrink-0 place-items-center rounded-md border text-sm font-bold ${
            item.done ? "mise-bg-good border-transparent text-ink-950" : "border-line-2"
          }`}
        >
          {item.done ? "✓" : ""}
        </span>
        <span
          className={`font-display font-semibold tabular-nums ${big ? "text-xl" : "text-base"} ${
            item.done ? "text-fg-faint" : "text-brand-300"
          }`}
        >
          {item.quantity}×
        </span>
        <span className={`min-w-0 flex-1 truncate ${item.done ? "text-fg-faint line-through" : "text-fg"}`}>
          {item.name}
        </span>
      </button>
    </li>
  );
}
