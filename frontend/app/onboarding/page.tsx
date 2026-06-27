"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, postForm } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useCurrency } from "@/lib/currency";
import { Logo } from "@/components/Logo";

type Row = Record<string, unknown>;
const NAME_KEY = "mise.user.name";

// Steps: a warm intro that learns your name, then the master-data imports.
const STEPS = [
  { key: "welcome", title: "Welcome to Mise" },
  { key: "items", title: "Your stock items" },
  { key: "vendors", title: "Your suppliers" },
  { key: "recipes", title: "Your menu" },
  { key: "staff", title: "Your team" },
  { key: "costs", title: "Your monthly costs" },
  { key: "sales", title: "Sales so far" },
  { key: "review", title: "Review" },
  { key: "done", title: "All set" },
] as const;

export default function OnboardingPage() {
  const router = useRouter();
  const { user, hotel, loading } = useAuth();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");

  // guard: must be logged in (you land here right after signup)
  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(NAME_KEY);
      if (saved) setName(saved);
    } catch {
      /* ignore */
    }
  }, []);

  function next() {
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }
  function saveNameAndNext() {
    const clean = name.trim();
    try {
      if (clean) localStorage.setItem(NAME_KEY, clean);
    } catch {
      /* ignore */
    }
    next();
  }
  function finish() {
    try { localStorage.setItem("mise.setup.done", "1"); } catch { /* ignore */ }
    router.replace("/dashboard");
  }

  if (loading || !user) return null;

  const pct = (step / (STEPS.length - 1)) * 100;
  const first = (name.trim().split(/\s+/)[0]) || "there";

  return (
    <div className="relative min-h-dvh overflow-hidden bg-[#0b1220] text-white">
      {/* animated premium backdrop */}
      <div
        className="mise-onb-bg pointer-events-none absolute inset-0 opacity-90"
        style={{
          background:
            "radial-gradient(900px 600px at 15% 10%, rgba(16,185,129,0.24), transparent 60%)," +
            "radial-gradient(800px 600px at 85% 20%, rgba(20,184,166,0.18), transparent 60%)," +
            "radial-gradient(900px 700px at 50% 100%, rgba(5,150,105,0.16), transparent 60%)," +
            "linear-gradient(120deg, #04120d, #07160f, #04120d)",
        }}
      />
      <div className="pointer-events-none absolute inset-0 opacity-[0.05] [background-image:radial-gradient(rgba(255,255,255,0.7)_1px,transparent_1px)] [background-size:22px_22px]" />

      <div className="relative mx-auto flex min-h-dvh max-w-xl flex-col px-5 py-8 sm:py-12">
        {/* header + progress */}
        <div className="flex items-center justify-between">
          <Logo className="h-8 w-auto" />
          <button onClick={finish} className="text-sm text-white/50 transition hover:text-white/80">
            Skip setup →
          </button>
        </div>
        <div className="mt-6 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-400 transition-[width] duration-700 ease-out"
            style={{ width: `${Math.max(pct, 6)}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-white/40">Step {step + 1} of {STEPS.length}</p>

        {/* step body (re-animates on step change via key) */}
        <div key={step} className="mise-step mt-8 flex-1">
          {step === 0 && (
            <Welcome
              hotelName={hotel?.name}
              name={name}
              setName={setName}
              onContinue={saveNameAndNext}
            />
          )}
          {step === 1 && (
            <ImportStep
              kind="items"
              noun="items"
              greetingName={first}
              heading="Add your stock items"
              blurb="Upload a list of what you keep in stock — a spreadsheet, a PDF, even a photo of a handwritten list. I'll read it and add everything, so your inventory isn't empty on day one."
              accept=".pdf,.csv,.xlsx,.xls,image/*"
              onNext={next}
            />
          )}
          {step === 2 && (
            <ImportStep
              kind="vendors"
              noun="suppliers"
              greetingName={first}
              heading="Add your suppliers"
              blurb="Now your suppliers and the prices they charge. Upload your supplier list and I'll set them up — then price comparison and recipe costing just work."
              accept=".pdf,.csv,.xlsx,.xls,image/*"
              onNext={next}
            />
          )}
          {step === 3 && (
            <ImportStep
              kind="recipes"
              noun="dishes"
              greetingName={first}
              heading="Add your menu"
              blurb="Upload your menu and I'll add each dish with its selling price — so your margins and Party Order pricing work straight away. (Add ingredients later to cost them to the gram.)"
              accept=".pdf,.csv,.xlsx,.xls,image/*"
              onNext={next}
            />
          )}
          {step === 4 && (
            <ImportStep
              kind="employees"
              noun="team members"
              greetingName={first}
              heading="Add your team"
              blurb="Upload your staff list — names, roles and pay. I'll add them so Rota, Attendance and Payroll are ready to go."
              accept=".pdf,.csv,.xlsx,.xls,image/*"
              onNext={next}
            />
          )}
          {step === 5 && <CostsStep onNext={next} />}
          {step === 6 && (
            <ImportStep
              kind="sales"
              noun="sales entries"
              greetingName={first}
              heading="Your recent sales"
              blurb="Upload a recent sales/takings report (spreadsheet, PDF, or a photo) and I'll log it — so your dashboard, profit and break-even show real numbers, not zero."
              accept=".pdf,.csv,.xlsx,.xls,image/*"
              onNext={next}
            />
          )}
          {step === 7 && <ReviewStep onNext={next} />}
          {step === 8 && <Done name={first} onFinish={finish} />}
        </div>
      </div>
    </div>
  );
}

function Welcome({
  hotelName,
  name,
  setName,
  onContinue,
}: {
  hotelName?: string;
  name: string;
  setName: (v: string) => void;
  onContinue: () => void;
}) {
  return (
    <div>
      <span className="mise-pop-lg inline-block text-5xl">👋</span>
      <h1 className="mt-4 font-display text-3xl font-semibold sm:text-4xl">
        Welcome{hotelName ? ` to ${hotelName}` : ""}.
      </h1>
      <p className="mt-3 text-white/70">
        I&apos;m <span className="font-medium text-white">Mise Copilot</span> — I&apos;ll help you set
        everything up in a couple of minutes. First, what should I call you?
      </p>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onContinue()}
        placeholder="Your name"
        className="mt-6 w-full rounded-2xl border border-white/15 bg-white/5 px-5 py-4 text-lg text-white placeholder-white/35 outline-none transition focus:border-emerald-400/60 focus:bg-white/10"
      />
      <button
        onClick={onContinue}
        className="mt-6 w-full rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 px-5 py-4 text-base font-semibold text-white shadow-lg shadow-emerald-500/20 transition hover:brightness-110"
      >
        {name.trim() ? `Nice to meet you, ${name.trim().split(/\s+/)[0]} →` : "Continue →"}
      </button>
    </div>
  );
}

function ImportStep({
  kind,
  noun,
  greetingName,
  heading,
  blurb,
  accept,
  onNext,
}: {
  kind: string;
  noun: string;
  greetingName: string;
  heading: string;
  blurb: string;
  accept: string;
  onNext: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("kind", kind);
      fd.append("file", file);
      const res = await postForm<{ rows: Row[] }>("/assistant/ingest", fd);
      if (!res.rows.length) setErr("I couldn't find anything in that file — try another, or skip.");
      else setRows(res.rows);
    } catch (e2) {
      setErr(
        e2 instanceof ApiError && e2.status === 429
          ? "I'm a bit busy right now — try again in a moment."
          : e2 instanceof ApiError && e2.status === 503
            ? "The AI isn't switched on yet."
            : "Sorry — I couldn't read that file."
      );
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!rows) return;
    setBusy(true);
    try {
      const res = await api.post<{ created: string[] }>("/assistant/ingest/commit", { kind, rows });
      setDone(res.created.length);
      setRows(null);
    } catch {
      setErr("Could not add those — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h2 className="font-display text-2xl font-semibold sm:text-3xl">{heading}</h2>
      <p className="mt-3 text-white/70">{blurb}</p>

      {done !== null ? (
        <div className="mise-pop-lg mt-6 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-5">
          <p className="text-lg font-semibold text-emerald-300">✓ Added {done} {noun}, {greetingName}!</p>
          <p className="mt-1 text-sm text-white/60">You can always add more later from the app.</p>
        </div>
      ) : rows ? (
        <div className="mt-6 rounded-2xl border border-white/15 bg-white/5 p-4">
          <p className="text-sm text-white/70">I found <span className="font-semibold text-white">{rows.length}</span> {noun}. Review and add:</p>
          <div className="mise-slide-stagger mt-3 max-h-52 space-y-1 overflow-y-auto pr-1 text-sm">
            {rows.slice(0, 60).map((r, i) => (
              <div key={i} className="flex justify-between gap-3 border-b border-white/5 py-1 last:border-0">
                <span className="truncate text-white/85">{String(r.name ?? r.full_name ?? r.date ?? "")}</span>
                <span className="shrink-0 text-white/45">
                  {r.amount != null
                    ? `£${r.amount}${r.channel ? ` · ${r.channel}` : ""}`
                    : r.selling_price != null
                      ? `£${r.selling_price}`
                      : String(r.category ?? r.unit ?? r.job_title ?? "")}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex gap-3">
            <button onClick={() => setRows(null)} disabled={busy} className="rounded-xl border border-white/15 px-4 py-2.5 text-sm text-white/70 hover:bg-white/5">Choose another</button>
            <button onClick={commit} disabled={busy} className="flex-1 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2.5 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50">
              {busy ? "Adding…" : `Add all ${rows.length}`}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-6">
          <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={onFile} />
          <button
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="group flex w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-white/20 bg-white/[0.03] px-6 py-10 text-center transition hover:border-emerald-400/50 hover:bg-white/[0.06] disabled:opacity-60"
          >
            <span className="text-3xl">{busy ? "⏳" : "📄"}</span>
            <span className="mt-2 font-medium text-white">{busy ? "Reading your file…" : "Upload PDF, Excel, CSV or a photo"}</span>
            <span className="mt-1 text-xs text-white/45">The AI reads it and fills this in for you</span>
          </button>
          {err && <p className="mt-3 text-sm text-rose-300">{err}</p>}
        </div>
      )}

      <div className="mt-8 flex items-center justify-between">
        <button onClick={onNext} className="text-sm text-white/50 transition hover:text-white/80">Skip for now →</button>
        {done !== null && (
          <button onClick={onNext} className="rounded-xl bg-white/10 px-5 py-2.5 text-sm font-semibold text-white hover:bg-white/15">Continue →</button>
        )}
      </div>
    </div>
  );
}

function CostsStep({ onNext }: { onNext: () => void }) {
  const [rent, setRent] = useState("");
  const [gas, setGas] = useState("");
  const [power, setPower] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function categoryId(name: string): Promise<string> {
    const cats = await api.get<{ id: string; name: string }[]>("/expenses/categories");
    const found = cats.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (found) return found.id;
    const made = await api.post<{ id: string }>("/expenses/categories", { name, kind: "FIXED" });
    return made.id;
  }

  async function save() {
    const entries: [string, string][] = [["Rent", rent], ["Gas", gas], ["Electricity", power]].filter(
      ([, v]) => v && Number(v) > 0
    ) as [string, string][];
    if (!entries.length) {
      onNext();
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const today = new Date().toISOString().slice(0, 10);
      for (const [cat, val] of entries) {
        const cid = await categoryId(cat);
        await api.post("/expenses", {
          category_id: cid, date: today, amount: val, payment_method: "BANK", description: `Monthly ${cat.toLowerCase()}`,
        });
      }
      setSaved(true);
      setTimeout(onNext, 900);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not save those.");
    } finally {
      setBusy(false);
    }
  }

  const field = "mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-white placeholder-white/30 outline-none focus:border-emerald-400/60";
  return (
    <div>
      <h2 className="font-display text-2xl font-semibold sm:text-3xl">Your monthly costs</h2>
      <p className="mt-3 text-white/70">
        A few fixed costs so your profit &amp; break-even are real from the start. Leave blank to skip any.
      </p>
      <div className="mise-slide-stagger mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <label className="block"><span className="text-sm text-white/60">Rent (£/mo)</span>
          <input value={rent} onChange={(e) => setRent(e.target.value)} inputMode="decimal" placeholder="0.00" className={field} /></label>
        <label className="block"><span className="text-sm text-white/60">Gas (£/mo)</span>
          <input value={gas} onChange={(e) => setGas(e.target.value)} inputMode="decimal" placeholder="0.00" className={field} /></label>
        <label className="block"><span className="text-sm text-white/60">Electricity (£/mo)</span>
          <input value={power} onChange={(e) => setPower(e.target.value)} inputMode="decimal" placeholder="0.00" className={field} /></label>
      </div>
      {err && <p className="mt-3 text-sm text-rose-300">{err}</p>}
      {saved && <p className="mise-pop-lg mt-3 text-sm font-medium text-emerald-300">✓ Saved</p>}
      <div className="mt-8 flex items-center justify-between">
        <button onClick={onNext} className="text-sm text-white/50 transition hover:text-white/80">Skip →</button>
        <button onClick={save} disabled={busy} className="rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-6 py-3 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50">
          {busy ? "Saving…" : "Save & continue →"}
        </button>
      </div>
    </div>
  );
}

function ReviewStep({ onNext }: { onNext: () => void }) {
  const { format } = useCurrency();
  const [pages, setPages] = useState<{ icon: string; title: string; rows: { main: string; sub: string }[] }[] | null>(null);
  const [pg, setPg] = useState(0);

  useEffect(() => {
    const g = (path: string) =>
      api.get<Record<string, unknown>[]>(path).catch(() => [] as Record<string, unknown>[]);
    Promise.all([g("/inventory/items"), g("/vendors"), g("/recipes"), g("/employees")]).then(
      ([items, vendors, recipes, staff]) => {
        setPages([
          {
            icon: "📦", title: "Stock items",
            rows: items.map((r) => ({
              main: String(r.name ?? ""),
              sub: `${r.current_stock ?? 0} ${r.unit ?? ""}${r.average_cost && Number(r.average_cost) > 0 ? ` · ${format(String(r.average_cost))}/${r.unit ?? "unit"}` : ""}`,
            })),
          },
          { icon: "🤝", title: "Suppliers", rows: vendors.map((r) => ({ main: String(r.name ?? ""), sub: String(r.category ?? "") })) },
          {
            icon: "🍲", title: "Menu",
            rows: recipes.map((r) => ({
              main: String(r.name ?? ""),
              sub: r.selling_price ? `${format(String(r.selling_price))}/plate` : "no price set",
            })),
          },
          { icon: "🧑‍🍳", title: "Team", rows: staff.map((r) => ({ main: String(r.full_name ?? r.name ?? ""), sub: String(r.job_title ?? "") })) },
        ]);
      }
    );
  }, [format]);

  if (!pages) {
    return <p className="text-white/60">Loading your data…</p>;
  }

  const p = pages[pg];
  const last = pg === pages.length - 1;

  return (
    <div>
      <h2 className="font-display text-2xl font-semibold sm:text-3xl">Quick review</h2>
      <p className="mt-2 text-white/70">
        Here&apos;s what went in. Flick through and make sure it looks right.
      </p>

      <div className="mt-5 rounded-2xl border border-white/15 bg-white/5 p-4">
        <div className="flex items-center justify-between">
          <span className="font-medium text-white">{p.icon} {p.title}</span>
          <span className="text-xs text-white/45">{p.rows.length} total · {pg + 1}/{pages.length}</span>
        </div>
        <div key={pg} className="mise-slide-stagger mt-3 max-h-64 space-y-1 overflow-y-auto pr-1 text-sm">
          {p.rows.length === 0 ? (
            <p className="py-6 text-center text-white/40">Nothing added here — you can add it anytime.</p>
          ) : (
            p.rows.slice(0, 80).map((r, i) => (
              <div key={i} className="flex justify-between gap-3 border-b border-white/5 py-1.5 last:border-0">
                <span className="truncate text-white/90">{r.main}</span>
                <span className="shrink-0 text-white/45">{r.sub}</span>
              </div>
            ))
          )}
        </div>
      </div>

      <p className="mt-4 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100/90">
        ✨ Something not right? Once you&apos;re in, tap <span className="font-semibold">Ask Mise</span> (bottom-right of
        any page) and just tell it — e.g. <span className="italic">&quot;change the price of Tomato to £2&quot;</span> — and
        it&apos;ll fix it on the spot.
      </p>

      <div className="mt-7 flex items-center justify-between">
        <button
          onClick={() => setPg((x) => Math.max(0, x - 1))}
          disabled={pg === 0}
          className="rounded-xl border border-white/15 px-4 py-2.5 text-sm text-white/70 hover:bg-white/5 disabled:opacity-30"
        >
          ← Back
        </button>
        {last ? (
          <button onClick={onNext} className="rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-6 py-3 text-sm font-semibold text-white hover:brightness-110">
            Looks right →
          </button>
        ) : (
          <button onClick={() => setPg((x) => Math.min(pages.length - 1, x + 1))} className="rounded-xl bg-white/10 px-6 py-3 text-sm font-semibold text-white hover:bg-white/15">
            Next →
          </button>
        )}
      </div>
    </div>
  );
}

function Done({ name, onFinish }: { name: string; onFinish: () => void }) {
  return (
    <div className="flex flex-col items-center text-center">
      <span className="mise-pop-lg text-6xl">🎉</span>
      <h2 className="mt-4 font-display text-3xl font-semibold sm:text-4xl">You&apos;re all set, {name}!</h2>
      <p className="mt-3 max-w-md text-white/70">
        Your dashboard is ready. You can add recipes, staff and past sales anytime — just ask the Copilot, or
        upload a file from any page. Welcome aboard. 🍽️
      </p>
      <button
        onClick={onFinish}
        className="mt-8 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 px-8 py-4 text-base font-semibold text-white shadow-lg shadow-emerald-500/20 transition hover:brightness-110"
      >
        Go to my dashboard →
      </button>
    </div>
  );
}
