import { useEffect, useRef, useState } from "react";
import { shareLocation } from "../../lib/monitoring";
import { distanceMeters } from "../../lib/geo";

const KEY = "planit.shareLocation";

function stored(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/** Sends the worker's position about every 60 s or 50 m while sharing is on and the page is open. */
export function useLocationSharing(
  siteId: string,
  onError: (message: string) => void,
) {
  const [enabled, setEnabledState] = useState(stored);
  const [lastSentAt, setLastSentAt] = useState<number>();
  const last = useRef<{ lat: number; lon: number; at: number } | undefined>(
    undefined,
  );
  const errorRef = useRef(onError);
  useEffect(() => {
    errorRef.current = onError;
  });

  function setEnabled(value: boolean) {
    setEnabledState(value);
    try {
      localStorage.setItem(KEY, value ? "1" : "0");
    } catch {
      // Sharing still works for this session.
    }
  }

  useEffect(() => {
    if (!enabled || !navigator.geolocation) return;
    last.current = undefined;
    const watch = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude: lat, longitude: lon, accuracy } = position.coords;
        const previous = last.current;
        const moved = previous
          ? distanceMeters(previous.lat, previous.lon, lat, lon)
          : Infinity;
        if (previous && moved < 50 && Date.now() - previous.at < 60000) return;
        last.current = { lat, lon, at: Date.now() };
        shareLocation(siteId, lat, lon, accuracy)
          .then(() => setLastSentAt(Date.now()))
          .catch((error) => errorRef.current(String(error?.message ?? error)));
      },
      () => {
        errorRef.current(
          "Couldn’t read your location. Allow location access to share it with your supervisor.",
        );
        setEnabled(false);
      },
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [enabled, siteId]);

  return {
    enabled,
    setEnabled,
    lastSentAt,
    supported: "geolocation" in navigator,
  };
}
