import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { tokenStorage, TOKEN_KEY } from "./api";
import { getBackendUrl } from "./backend";

type Handler = (event: string, payload: any) => void;

/**
 * Subscribes to the backend ride WebSocket using the current auth token.
 * Reconnects automatically with backoff. No-op until token is available.
 */
export function useRideSocket(handler: Handler, enabled: boolean = true) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return;
    let ws: WebSocket | null = null;
    let cancelled = false;
    let retryDelay = 1000;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const baseUrl = getBackendUrl();
    const wsUrl = baseUrl.replace(/^http/, "ws");

    const connect = async () => {
      const token = await tokenStorage.getItem(TOKEN_KEY);
      if (!token || cancelled) return;
      try {
        ws = new WebSocket(`${wsUrl}/api/ws/rides?token=${encodeURIComponent(token)}`);
        ws.onopen = () => {
          retryDelay = 1000;
        };
        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(typeof e.data === "string" ? e.data : "");
            if (msg && msg.event) handlerRef.current(msg.event, msg.payload);
          } catch {
            // ignore malformed
          }
        };
        ws.onerror = () => {
          // will trigger close
        };
        ws.onclose = () => {
          if (cancelled) return;
          reconnectTimer = setTimeout(connect, retryDelay);
          retryDelay = Math.min(retryDelay * 2, 15000);
        };
      } catch {
        if (!cancelled) reconnectTimer = setTimeout(connect, retryDelay);
      }
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) {
        try {
          ws.close();
        } catch {
          // ignore
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
}

// Silence unused on web
export const _platform = Platform.OS;
