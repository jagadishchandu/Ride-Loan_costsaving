import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { api } from "./api";

let configured = false;

function isWeb() {
  return Platform.OS === "web";
}

export async function ensureNotificationSetup() {
  if (configured || isWeb()) return;
  configured = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted") {
      await Notifications.requestPermissionsAsync();
    }
  } catch {
    // ignore
  }
}

/**
 * Register an Expo push token with the backend. Quietly does nothing on web,
 * simulator, or if permission was denied. Used for remote push from server.
 *
 * NOTE: Remote push only works in EAS dev/production builds, not in Expo Go
 * (SDK 54+). The token is still registered for future builds.
 */
export async function registerPushToken() {
  if (isWeb() || !Device.isDevice) return;
  try {
    await ensureNotificationSetup();
    const projectId =
      Constants?.expoConfig?.extra?.eas?.projectId ||
      Constants?.easConfig?.projectId;
    const tokenRes = projectId
      ? await Notifications.getExpoPushTokenAsync({ projectId })
      : await Notifications.getExpoPushTokenAsync();
    const token = tokenRes.data;
    if (!token) return;
    await api.post("/push/register", { token, platform: Platform.OS });
  } catch {
    // ignore - push tokens require a dev build, expected to fail in Expo Go
  }
}

export async function notify(title: string, body: string) {
  if (isWeb()) {
    try {
      if (typeof window !== "undefined" && "Notification" in window) {
        if (window.Notification.permission === "granted") {
          new window.Notification(title, { body });
        } else if (window.Notification.permission !== "denied") {
          const perm = await window.Notification.requestPermission();
          if (perm === "granted") new window.Notification(title, { body });
        }
      }
    } catch {
      // ignore
    }
    return;
  }
  await ensureNotificationSetup();
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body },
      trigger: null,
    });
  } catch {
    // ignore
  }
}
