"use client";

// 🛵 The customer's live delivery map: home 📍 + the rider gliding toward it.
// The rider marker eases between GPS beacons (rAF lerp) so it FLOWS like
// Zomato instead of teleporting every poll. Free CARTO tiles, no keys.

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const HOME = L.divIcon({
  className: "",
  html: '<div style="font-size:30px;line-height:1;transform:translate(-50%,-100%);filter:drop-shadow(0 2px 3px rgba(0,0,0,.4));">📍</div>',
  iconSize: [0, 0],
});
const RIDER = L.divIcon({
  className: "",
  html: '<div style="font-size:28px;line-height:1;transform:translate(-50%,-50%);filter:drop-shadow(0 2px 4px rgba(0,0,0,.45));">🛵</div>',
  iconSize: [0, 0],
});

export default function LiveMap({
  dark = true,
  home,
  rider,
}: {
  dark?: boolean;
  home: { lat: number; lng: number } | null;
  rider: { lat: number; lng: number } | null;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const homeRef = useRef<L.Marker | null>(null);
  const riderRef = useRef<L.Marker | null>(null);
  const animRef = useRef<number | null>(null);

  useEffect(() => {
    if (!boxRef.current || mapRef.current) return;
    const map = L.map(boxRef.current, { zoomControl: false }).setView([52.5, -1.9], 6);
    L.tileLayer(
      dark
        ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        : "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
      { maxZoom: 19, attribution: "© OSM © CARTO" },
    ).addTo(map);
    mapRef.current = map;
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      map.remove();
      mapRef.current = null;
      homeRef.current = null;
      riderRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // home pin: set once, frame both points
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !home) return;
    if (!homeRef.current) homeRef.current = L.marker([home.lat, home.lng], { icon: HOME }).addTo(map);
    else homeRef.current.setLatLng([home.lat, home.lng]);
  }, [home]);

  // rider beacon: glide from the previous point over ~1.2s
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !rider) return;
    if (!riderRef.current) {
      riderRef.current = L.marker([rider.lat, rider.lng], { icon: RIDER }).addTo(map);
    } else {
      const from = riderRef.current.getLatLng();
      const start = performance.now();
      const step = (now: number) => {
        const k = Math.min(1, (now - start) / 1200);
        const e = 1 - Math.pow(1 - k, 3); // ease-out — arrives softly
        riderRef.current!.setLatLng([
          from.lat + (rider.lat - from.lat) * e,
          from.lng + (rider.lng - from.lng) * e,
        ]);
        if (k < 1) animRef.current = requestAnimationFrame(step);
      };
      if (animRef.current) cancelAnimationFrame(animRef.current);
      animRef.current = requestAnimationFrame(step);
    }
    // keep both actors in view
    if (home) {
      map.fitBounds(
        L.latLngBounds([home.lat, home.lng], [rider.lat, rider.lng]).pad(0.35),
        { animate: true },
      );
    } else {
      map.setView([rider.lat, rider.lng], 15, { animate: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rider?.lat, rider?.lng]);

  return <div ref={boxRef} className="h-60 w-full overflow-hidden rounded-2xl border border-line" />;
}
