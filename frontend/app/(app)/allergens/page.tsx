"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, downloadFile, type AllergenRow } from "@/lib/api";
import { Badge, Card, PageHeader, Spinner } from "@/components/ui";
import { ALLERGEN_LABEL } from "@/lib/allergens";

export default function AllergensPage() {
  const [rows, setRows] = useState<AllergenRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<AllergenRow[]>("/recipes/allergen-matrix")
      .then(setRows)
      .catch(() => setErr("Could not load the allergen matrix."));
  }, []);

  if (err) return <p className="rounded-lg bg-amber-400/10 px-3 py-2 text-sm text-amber-300">{err}</p>;
  if (!rows) return <Spinner />;

  const reviewedNeeded = rows.filter((r) => r.unreviewed.length > 0).length;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title="Allergens"
          subtitle="Per-dish allergens (UK Natasha's Law), built from each recipe's ingredients."
        />
        <button
          onClick={() => downloadFile("/recipes/allergen-matrix.pdf", "allergen-matrix.pdf")}
          className="rounded-lg border border-line-2 px-3 py-1.5 text-sm font-medium text-fg-soft hover:bg-paper-2"
        >
          ⬇ Download (PDF)
        </button>
      </div>

      <p className="mb-4 rounded-lg bg-glass/5 px-3 py-2 text-xs text-fg-faint">
        Allergens are tagged once per ingredient on the{" "}
        <Link href="/inventory" className="text-brand-400 hover:underline">Inventory</Link> page (edit an
        item) — dishes inherit them here automatically.
        {reviewedNeeded > 0 && (
          <span className="text-amber-300">
            {" "}⚠ {reviewedNeeded} dish{reviewedNeeded === 1 ? "" : "es"} have ingredients not yet
            reviewed — tag them so this sheet is complete.
          </span>
        )}
      </p>

      {rows.length === 0 ? (
        <Card>
          <p className="py-6 text-center text-sm text-fg-faint">No recipes yet.</p>
        </Card>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.recipe_id} className="px-5 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-fg">{r.name}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {r.allergens.length === 0 && r.unreviewed.length === 0 ? (
                      <Badge tone="green">no listed allergens</Badge>
                    ) : (
                      r.allergens.map((a) => (
                        <Badge key={a} tone="red">{ALLERGEN_LABEL[a] ?? a}</Badge>
                      ))
                    )}
                  </div>
                </div>
                {r.unreviewed.length > 0 && (
                  <p className="mt-1 text-xs text-amber-300">
                    ⚠ Not reviewed: {r.unreviewed.join(", ")} — tag on Inventory to confirm.
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <p className="mt-3 text-xs text-fg-faint">
        The 14 declarable allergens: {Object.values(ALLERGEN_LABEL).join(", ")}.
      </p>
    </div>
  );
}
