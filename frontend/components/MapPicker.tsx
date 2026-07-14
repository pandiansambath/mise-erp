"use client";

// 📍 Delivery pin-drop — Leaflet + free CARTO/OSM tiles (no API key).
// Tap (or drag the pin) to mark the exact door; we reverse-geocode the pin
// via Nominatim and AUTO-FILL the address field (still editable). "Use my
// location" honours the browser's accuracy radius honestly — desktop wifi
// location can be street-level-wrong, so we show the uncertainty circle and
// say so. Import with next/dynamic ssr:false (Leaflet touches `window`).

import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const PIN = L.divIcon({
  className: "",
  html: '<div style="font-size:32px;line-height:1;transform:translate(-50%,-100%);filter:drop-shadow(0 2px 3px rgba(0,0,0,.4));">📍</div>',
  iconSize: [0, 0],
});

const UK_CENTRE: [number, number] = [52.5, -1.9];

// Themed tiles: CARTO's free basemaps match the app's light/dark mood far
// better than raw OSM (attribution required, kept below).
const TILES = {
  light: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
  dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
};
const ATTRIB =
  '© <a href="https://www.openstreetmap.org/copyright">OSM</a> © <a href="https://carto.com/attributions">CARTO</a>';

export default function MapPicker({
  dark = true,
  onPick,
  onAddress,
}: {
  dark?: boolean;
  onPick: (lat: number, lng: number) => void;
  onAddress?: (address: string) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const circleRef = useRef<L.Circle | null>(null);
  const revAbort = useRef<AbortController | null>(null);
  const [placed, setPlaced] = useState(false);
  const [locating, setLocating] = useState(false);
  const [accuracy, setAccuracy] = useState<number | null>(null);

  // The pin's address, fetched politely from Nominatim (free, 1 req/sec).
  function reverseGeocode(lat: number, lng: number) {
    if (!onAddress) return;
    revAbort.current?.abort();
    const ctrl = new AbortController();
    revAbort.current = ctrl;
    fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18`,
      { signal: ctrl.signal, headers: { Accept: "application/json" } },
    )
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        if (d?.display_name) onAddress(d.display_name);
      })
      .catch(() => {});
  }

  useEffect(() => {
    if (!boxRef.current || mapRef.current) return;
    const map = L.map(boxRef.current, { zoomControl: true }).setView(UK_CENTRE, 6);
    L.tileLayer(dark ? TILES.dark : TILES.light, { maxZoom: 20, attribution: ATTRIB }).addTo(map);

    function place(lat: number, lng: number, fill = true) {
      if (markerRef.current) {
        markerRef.current.setLatLng([lat, lng]);
      } else {
        markerRef.current = L.marker([lat, lng], { icon: PIN, draggable: true }).addTo(map);
        markerRef.current.on("dragend", () => {
          const p = markerRef.current!.getLatLng();
          onPick(p.lat, p.lng);
          reverseGeocode(p.lat, p.lng);
        });
      }
      setPlaced(true);
      onPick(lat, lng);
      if (fill) reverseGeocode(lat, lng);
    }

    map.on("click", (e: L.LeafletMouseEvent) => place(e.latlng.lat, e.latlng.lng));
    // expose for the locate button (avoids re-creating the map per render)
    (map as L.Map & { _misePlace?: typeof place })._misePlace = place;
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      circleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function useMyLocation() {
    const map = mapRef.current as
      | (L.Map & { _misePlace?: (lat: number, lng: number, fill?: boolean) => void })
      | null;
    if (!navigator.geolocation || !map) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const { latitude, longitude, accuracy: acc } = pos.coords;
        setAccuracy(Math.round(acc));
        // honest uncertainty: the browser gives a RADIUS, we show it
        if (circleRef.current) circleRef.current.setLatLng([latitude, longitude]).setRadius(acc);
        else
          circleRef.current = L.circle([latitude, longitude], {
            radius: acc, color: "#38bdf8", weight: 1.5, fillOpacity: 0.12,
          }).addTo(map);
        map.setView([latitude, longitude], acc > 300 ? 14 : 17);
        map._misePlace?.(latitude, longitude);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  return (
    <div className="space-y-1.5">
      <div ref={boxRef} className="h-64 w-full overflow-hidden rounded-xl border border-line" />
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] leading-tight text-fg-faint">
          {placed
            ? accuracy && accuracy > 150
              ? `📍 pin set (location accurate to ~${accuracy}m — drag it onto your door)`
              : "📍 pin set — the address filled itself, edit it freely"
            : "tap the map to drop a pin on your door — the address fills itself"}
        </p>
        <button
          type="button"
          onClick={useMyLocation}
          disabled={locating}
          className="mise-raised mise-press shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-fg-soft disabled:opacity-60"
        >
          {locating ? "Locating…" : "🎯 Use my location"}
        </button>
      </div>
    </div>
  );
}
