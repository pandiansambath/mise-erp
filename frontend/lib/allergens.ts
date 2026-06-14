// The 14 allergens that must be declared under UK law (FIC 1169/2011 / Natasha's Law).
export const ALLERGENS = [
  { code: "gluten", label: "Cereals (gluten)" },
  { code: "crustaceans", label: "Crustaceans" },
  { code: "eggs", label: "Eggs" },
  { code: "fish", label: "Fish" },
  { code: "peanuts", label: "Peanuts" },
  { code: "soya", label: "Soya" },
  { code: "milk", label: "Milk" },
  { code: "nuts", label: "Tree nuts" },
  { code: "celery", label: "Celery" },
  { code: "mustard", label: "Mustard" },
  { code: "sesame", label: "Sesame" },
  { code: "sulphites", label: "Sulphites" },
  { code: "lupin", label: "Lupin" },
  { code: "molluscs", label: "Molluscs" },
] as const;

export const ALLERGEN_LABEL: Record<string, string> = Object.fromEntries(
  ALLERGENS.map((a) => [a.code, a.label]),
);

/** Parse the stored CSV ("milk,gluten") into a code list. */
export function parseAllergens(csv: string | null | undefined): string[] {
  if (!csv) return [];
  return csv.split(",").map((s) => s.trim()).filter(Boolean);
}
