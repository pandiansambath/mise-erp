"use client";

import { useAuth } from "@/lib/auth";

// The backend stores all timestamps in UTC. The UI shows them in the HOTEL's
// region time (the country chosen at signup), so a London venue's clock reads
// London time no matter where the viewer is sitting.
const TZ_BY_COUNTRY: Record<string, string> = {
  GB: "Europe/London",
  IN: "Asia/Kolkata",
  US: "America/New_York",
  AE: "Asia/Dubai",
  EU: "Europe/Paris",
};

export function tzForCountry(country: string | null | undefined): string {
  return (country && TZ_BY_COUNTRY[country.toUpperCase()]) || "Europe/London";
}

/** Formatters bound to the current hotel's timezone. */
export function useHotelTime() {
  const { hotel } = useAuth();
  const timeZone = tzForCountry(hotel?.country);

  const time = (iso: string | null | undefined): string =>
    iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone }) : "—";

  const dateTime = (iso: string | null | undefined): string =>
    iso
      ? new Date(iso).toLocaleString([], {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone,
        } as Intl.DateTimeFormatOptions)
      : "—";

  return { timeZone, time, dateTime };
}
