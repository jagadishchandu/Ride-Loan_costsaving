/**
 * Geocoding via our backend proxy. Uses Azure Maps when AZURE_MAPS_KEY is set,
 * automatically falls back to OpenStreetMap Nominatim. Includes a tiny in-memory
 * cache so re-typing the same query is instant.
 */
import { api } from "./api";

export type GeoResult = {
  lat: number;
  lng: number;
  address: string;
};

const searchCache = new Map<string, GeoResult[]>();
const reverseCache = new Map<string, string>();
const SEARCH_CACHE_LIMIT = 100;
const REVERSE_CACHE_LIMIT = 200;

function trimCache<K, V>(cache: Map<K, V>, limit: number) {
  while (cache.size > limit) {
    const first = cache.keys().next().value;
    if (first === undefined) break;
    cache.delete(first);
  }
}

export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  const cached = reverseCache.get(key);
  if (cached) return cached;
  try {
    const res = await api.get<{ address: string }>("/maps/reverse", {
      params: { lat, lng },
    });
    const addr = res.data.address || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    reverseCache.set(key, addr);
    trimCache(reverseCache, REVERSE_CACHE_LIMIT);
    return addr;
  } catch {
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  }
}

export async function searchPlaces(query: string): Promise<GeoResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const cached = searchCache.get(q.toLowerCase());
  if (cached) return cached;
  try {
    const res = await api.get<{ results: GeoResult[] }>("/maps/search", {
      params: { q },
    });
    const results = res.data.results || [];
    searchCache.set(q.toLowerCase(), results);
    trimCache(searchCache, SEARCH_CACHE_LIMIT);
    return results;
  } catch {
    return [];
  }
}
