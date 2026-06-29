"use client";

// Reusable superadmin "manage a configurable list" panel: add (with extra fields),
// rename inline, and ARCHIVE/RESTORE with a usage-impact warning (archiving only
// hides from new entries — past records keep the value, so it's always safe).
import { type ReactNode, useState } from "react";
import { Badge, Card } from "@/components/ui";
import { useConfirm } from "@/components/confirm";

export type ManagedItem = {
  id: string;
  name: string;
  is_active: boolean;
  usage_count: number;
  badge?: string;
};

export type AddField = {
  key: string;
  label: string;
  type: "select" | "number" | "text";
  options?: { value: string; label: string }[];
  placeholder?: string;
  default?: string;
};

export function ListManager({
  title,
  noun,
  usageNoun,
  items,
  addFields = [],
  onAdd,
  onRename,
  onSetActive,
  reload,
  renderRowExtra,
  embedded = false,
}: {
  title: string;
  noun: string; // e.g. "category"
  usageNoun: string; // e.g. "expense"
  items: ManagedItem[];
  addFields?: AddField[];
  onAdd: (name: string, extra: Record<string, string>) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onSetActive: (id: string, active: boolean) => Promise<void>;
  reload: () => Promise<void> | void;
  renderRowExtra?: (item: ManagedItem) => ReactNode;
  embedded?: boolean; // inside a modal → no Card/toggle chrome, always open
}) {
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [extra, setExtra] = useState<Record<string, string>>(
    Object.fromEntries(addFields.map((f) => [f.key, f.default ?? ""]))
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const active = items.filter((i) => i.is_active);
  const archived = items.filter((i) => !i.is_active);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await onAdd(name.trim(), extra);
      setFlash(`Added “${name.trim()}”.`);
      setName("");
      setExtra(Object.fromEntries(addFields.map((f) => [f.key, f.default ?? ""])));
      await reload();
      setTimeout(() => setFlash(null), 2500);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : `Could not add ${noun}.`);
    } finally {
      setBusy(false);
    }
  }

  async function rename(id: string, current: string, next: string) {
    if (!next.trim() || next.trim() === current) return;
    try {
      await onRename(id, next.trim());
      await reload();
    } catch {
      /* keep the old value visible */
    }
  }

  async function archive(item: ManagedItem) {
    const ok = await confirm({
      title: `Archive “${item.name}”?`,
      message:
        item.usage_count > 0
          ? `${item.usage_count} ${usageNoun}${item.usage_count === 1 ? "" : "s"} already use “${item.name}”. Archiving HIDES it from new entries — but those past records keep it, so nothing changes in your numbers. You can restore it anytime.`
          : `This hides “${item.name}” from new entries. Nothing uses it yet, and you can restore it anytime.`,
      confirmText: "Archive",
      tone: "danger",
    });
    if (!ok) return;
    await onSetActive(item.id, false);
    await reload();
  }

  async function restore(item: ManagedItem) {
    await onSetActive(item.id, true);
    await reload();
  }

  const inner = (
    <div className="space-y-4">
      {/* Add */}
          <form
            onSubmit={add}
            className="flex flex-col gap-2 rounded-xl border border-brand-500/30 bg-brand-500/5 p-3 sm:flex-row sm:items-end"
          >
            <div className="flex-1">
              <label className="block text-sm font-medium text-fg-soft">New {noun}</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={`Add a ${noun}…`}
                className="mt-1 w-full rounded-lg border border-line-2 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25"
              />
            </div>
            {addFields.map((f) => (
              <div key={f.key} className="w-full sm:w-40">
                <label className="block text-sm font-medium text-fg-soft">{f.label}</label>
                {f.type === "select" ? (
                  <select
                    value={extra[f.key] ?? ""}
                    onChange={(e) => setExtra((x) => ({ ...x, [f.key]: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-line-2 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500"
                  >
                    {(f.options ?? []).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={extra[f.key] ?? ""}
                    onChange={(e) => setExtra((x) => ({ ...x, [f.key]: e.target.value }))}
                    inputMode={f.type === "number" ? "decimal" : "text"}
                    placeholder={f.placeholder}
                    className="mt-1 w-full rounded-lg border border-line-2 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500"
                  />
                )}
              </div>
            ))}
            <button
              disabled={busy}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-transform hover:bg-brand-700 active:scale-95 disabled:opacity-60"
            >
              ＋ Add
            </button>
          </form>
          {flash && <p className="text-sm text-brand-300">{flash}</p>}
          {err && <p className="text-sm text-rose-400">{err}</p>}

          {/* Active list — one clear row per item (full width so the name is never squeezed) */}
          <div className="space-y-2">
            {active.length === 0 && (
              <p className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-sm text-fg-faint">
                No active {noun}s yet — add your first one above.
              </p>
            )}
            {active.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-3 rounded-xl border border-line bg-paper-2/40 px-3 py-2.5 text-sm transition-colors hover:border-brand-400/60"
              >
                <input
                  defaultValue={item.name}
                  onBlur={(e) => rename(item.id, item.name, e.target.value)}
                  title="Click to rename"
                  className="min-w-0 flex-1 truncate rounded-md border border-transparent bg-transparent px-2 py-1 font-medium text-fg outline-none hover:border-line focus:border-brand-500 focus:bg-paper focus:ring-2 focus:ring-brand-500/25"
                />
                {item.badge && <Badge tone="slate">{item.badge}</Badge>}
                {renderRowExtra?.(item)}
                <span className="shrink-0 whitespace-nowrap text-xs text-fg-faint">
                  {item.usage_count} {usageNoun}
                  {item.usage_count === 1 ? "" : "s"}
                </span>
                <button
                  onClick={() => archive(item)}
                  className="shrink-0 rounded-md border border-line px-2.5 py-1 text-xs text-fg-faint transition-colors hover:border-rose-400/50 hover:bg-rose-500/10 hover:text-rose-300"
                  title={`Hide this ${noun} from new entries`}
                >
                  Archive
                </button>
              </div>
            ))}
          </div>

          {/* Archived list */}
          {archived.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-faint">
                Archived (hidden from new entries)
              </p>
              <div className="space-y-2">
                {archived.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-line/60 bg-paper-2/40 px-3 py-2 text-sm opacity-70"
                  >
                    <span className="min-w-0 truncate text-fg-soft line-through">{item.name}</span>
                    <button
                      onClick={() => restore(item)}
                      className="shrink-0 rounded-md border border-brand-500/40 px-2 py-1 text-xs text-brand-300 hover:bg-brand-500/10"
                    >
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
    </div>
  );

  // Embedded (inside a modal that already supplies the title + chrome): show the
  // body directly — no extra Card, no "Superadmin ▼" collapse to click through.
  if (embedded) return inner;

  return (
    <Card className="mt-6">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="flex items-center gap-2">
          <h3 className="font-semibold text-fg">{title}</h3>
          <Badge tone="green">Superadmin</Badge>
        </span>
        <span className={`text-fg-faint transition-transform duration-200 ${open ? "rotate-180" : ""}`}>
          ▼
        </span>
      </button>
      {open && <div className="mise-fade mt-4">{inner}</div>}
    </Card>
  );
}
