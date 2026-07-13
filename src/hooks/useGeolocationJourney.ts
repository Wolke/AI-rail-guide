import { useCallback, useEffect, useRef, useState } from "react";
import { updateLocation } from "../lib/api";
import { saveJourneyState } from "../lib/storage";
import type { GpsPoint, JourneyEventType, JourneyState, LocationUpdateResult } from "../shared/types";

interface UseGeolocationJourneyArgs {
  journeyId?: string;
  enabled: boolean;
  onLocationResult(result: LocationUpdateResult): void;
  onJourneyEvent(event: JourneyEventType, state: JourneyState): void;
}

export function useGeolocationJourney({ journeyId, enabled, onLocationResult, onJourneyEvent }: UseGeolocationJourneyArgs) {
  const [error, setError] = useState<string>("");
  const watchId = useRef<number | null>(null);
  const callbacks = useRef({ onLocationResult, onJourneyEvent });
  callbacks.current = { onLocationResult, onJourneyEvent };

  const handlePoint = useCallback(
    async (point: Partial<GpsPoint>) => {
      if (!journeyId) return;
      try {
        const result = await updateLocation(journeyId, point);
        callbacks.current.onLocationResult(result);
        await saveJourneyState(result.state);
        if (result.event) {
          callbacks.current.onJourneyEvent(result.event, result.state);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Location update failed.");
      }
    },
    [journeyId]
  );

  useEffect(() => {
    if (!enabled || !journeyId) return;
    if (!("geolocation" in navigator)) {
      setError("This browser does not support GPS geolocation.");
      return;
    }

    watchId.current = navigator.geolocation.watchPosition(
      (position) => {
        setError("");
        void handlePoint({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
          speed: position.coords.speed,
          timestamp: position.timestamp
        });
      },
      () => {
        void handlePoint({});
        setError("GPS signal is unavailable; using estimated journey state.");
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    );

    return () => {
      if (watchId.current != null) {
        navigator.geolocation.clearWatch(watchId.current);
      }
    };
  }, [enabled, handlePoint, journeyId]);

  return {
    error,
    mockLocation: handlePoint
  };
}
