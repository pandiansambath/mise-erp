"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, downloadFile, type AllergenRow } from "@/lib/api";
import { Badge, Button, Card, PageHeader, Spinner } from "@/components/ui";
import { Donut } from "@/components/charts";
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
  const clear = rows.filter((r) => r.allergens.length === 0 && r.unreviewed.length === 0).length;
  // mutually exclusive with "needs review" so the donut sums to the dish count
  const withAllergens = rows.filter((r) => r.allergens.length > 0 && r.unreviewed.length === 0).length;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title="Allergens"
          subtitle="Per-dish allergens (UK Natasha's Law), built from each recipe's ingredients."
        />
        <Button variant="soft" onClick={() => downloadFile("/recipes/allergen-matrix.pdf", "allergen-matrix.pdf")}>
          ⬇ Download (PDF)
        </Button>
      </div>

      {rows.length > 0 && (
        <Card className="mise-feel mb-4">
          <h3 className="font-semibold text-fg">Menu safety at a glance</h3>
          <p className="text-xs text-fg-faint">every dish should be green or red — amber means the sheet isn&apos;t legally complete yet</p>
          <div className="mt-4">
            <Donut
              centerLabel="dishes"
              centerValue={String(rows.length)}
              segments={[
                { label: "No listed allergens", value: clear, color: "#10b981" },
                { label: "Contains allergens", value: withAllergens, color: "#f43f5e" },
                { label: "Needs review", value: reviewedNeeded, color: "#f59e0b" },
              ].filter((s) => s.value > 0)}
            />
          </div>
        </Card>
      )}

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
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((r) => (
            <Card key={r.recipe_id} className="mise-feel">
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
                <p className="mt-2 text-xs text-amber-300">
                  ⚠ Not reviewed: {r.unreviewed.join(", ")} — tag on Inventory to confirm.
                </p>
              )}
            </Card>
          ))}
        </div>
      )}

      <p className="mt-3 text-xs text-fg-faint">
        The 14 declarable allergens: {Object.values(ALLERGEN_LABEL).join(", ")}.
      </p>
    </div>
  );
}
