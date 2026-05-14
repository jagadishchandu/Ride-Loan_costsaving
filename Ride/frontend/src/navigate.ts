import { Platform, Linking } from "react-native";

/**
 * Open the user's LOCAL maps app for turn-by-turn navigation.
 * No API key required — uses native deep-links / intents.
 *
 * Resolution order:
 * - iOS: Google Maps (if installed) → Apple Maps → web fallback
 * - Android: google.navigation: intent → geo: intent → web fallback
 * - Web: Google Maps in a new tab
 */
export async function navigateTo(destLat: number, destLng: number, label?: string) {
  const webUrl = `https://www.google.com/maps/dir/?api=1&destination=${destLat},${destLng}&travelmode=driving${
    label ? `&destination_place_id=${encodeURIComponent(label)}` : ""
  }`;

  if (Platform.OS === "web") {
    if (typeof window !== "undefined") window.open(webUrl, "_blank");
    return;
  }

  if (Platform.OS === "ios") {
    const gmaps = `comgooglemaps://?daddr=${destLat},${destLng}&directionsmode=driving`;
    const apple = `maps://?daddr=${destLat},${destLng}&dirflg=d`;
    if (await safeCanOpen(gmaps)) {
      await Linking.openURL(gmaps);
      return;
    }
    if (await safeCanOpen(apple)) {
      await Linking.openURL(apple);
      return;
    }
    await Linking.openURL(webUrl);
    return;
  }

  // Android
  const navIntent = `google.navigation:q=${destLat},${destLng}&mode=d`;
  const geoIntent = `geo:${destLat},${destLng}?q=${destLat},${destLng}${
    label ? `(${encodeURIComponent(label)})` : ""
  }`;
  if (await safeCanOpen(navIntent)) {
    await Linking.openURL(navIntent);
    return;
  }
  if (await safeCanOpen(geoIntent)) {
    await Linking.openURL(geoIntent);
    return;
  }
  await Linking.openURL(webUrl);
}

/**
 * Open the user's LOCAL maps app to VIEW a location (no driving directions).
 * Optionally pass multiple markers — most map apps only honor one, so we use the first.
 */
export async function viewOnMaps(lat: number, lng: number, label?: string) {
  const webUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}${
    label ? `&query_place_id=${encodeURIComponent(label)}` : ""
  }`;
  if (Platform.OS === "web") {
    if (typeof window !== "undefined") window.open(webUrl, "_blank");
    return;
  }
  if (Platform.OS === "ios") {
    const gmaps = `comgooglemaps://?q=${lat},${lng}${label ? `&q=${encodeURIComponent(label)}` : ""}`;
    const apple = `maps://?ll=${lat},${lng}${label ? `&q=${encodeURIComponent(label)}` : ""}`;
    if (await safeCanOpen(gmaps)) return Linking.openURL(gmaps);
    if (await safeCanOpen(apple)) return Linking.openURL(apple);
    return Linking.openURL(webUrl);
  }
  const geoIntent = `geo:${lat},${lng}?q=${lat},${lng}${label ? `(${encodeURIComponent(label)})` : ""}`;
  if (await safeCanOpen(geoIntent)) return Linking.openURL(geoIntent);
  return Linking.openURL(webUrl);
}

async function safeCanOpen(url: string): Promise<boolean> {
  try {
    return await Linking.canOpenURL(url);
  } catch {
    return false;
  }
}
