"use client";

// 📍 Delivery pin-drop — Leaflet + OpenStreetMap (free tiles, no API key).
// The customer taps (or drags the pin) to mark their exact door; we hand the
// coordinates back to the checkout form. "Use my location" jumps the map via
// the browser's geolocation. Import this with next/dynamic ssr:false —
// Leaflet touches `window` at import time.

import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Leaflet's default marker images break under bundlers — an emoji divIcon
// needs no assets and matches the app's language.
const PIN = L.divIcon({
  className: "",
  html: '<div style="font-size:30px;line-height:1;transform:translate(-50%,-100%);filter:drop-shadow(0 2px 3px rgba(0,0,0,.4));">📍</div>',
  iconSize: [0, 0],
});

const UK_CENTRE: [number, number] = [52.5, -1.9]; // roughly Birmingham

export default function MapPicker({
  onPick,
}: {
  onPick: (lat: number, lng: number) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const [placed, setPlaced] = useState(false);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    if (!boxRef.current || mapRef.current) return;
    const map = L.map(boxRef.current, { zoomControl: true, attributionControl: true })
      .setView(UK_CENTRE, 6);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    function place(lat: number, lng: number) {
      if (markerRef.current) {
        markerRef.current.setLatLng([lat, lng]);
      } else {
        markerRef.current = L.marker([lat, lng], { icon: PIN, draggable: true }).addTo(map);
        markerRef.current.on("dragend", () => {
          const p = markerRef.current!.getLatLng();
          onPick(p.lat, p.lng);
        });
      }
      setPlaced(true);
      onPick(lat, lng);
    }

    map.on("click", (e: L.LeafletMouseEvent) => place(e.latlng.lat, e.latlng.lng));
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function useMyLocation() {
    if (!navigator.geolocation || !mapRef.current) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const { latitude, longitude } = pos.coords;
        mapRef.current?.setView([latitude, longitude], 16);
        mapRef.current?.fire("click", { latlng: L.latLng(latitude, longitude) });
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  return (
    <div className="space-y-1.5">
      <div ref={boxRef} className="h-52 w-full overflow-hidden rounded-xl border border-line" />
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-fg-faint">
          {placed ? "📍 pin set — drag it to fine-tune" : "tap the map to drop a pin on your door"}
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
