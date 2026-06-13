import { api } from "@/api/client";
import type { DeviceState } from "@/api/types";

const TTL_MS = 30 * 1000;

let cache: { value: DeviceState; ts: number } | null = null;
let inflight: Promise<DeviceState> | null = null;

export async function fetchDeviceState(force = false): Promise<DeviceState> {
  const now = Date.now();
  if (!force && cache && now - cache.ts < TTL_MS) {
    return cache.value;
  }
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const value = await api.get<DeviceState>("/system/device");
      cache = { value, ts: Date.now() };
      return value;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function clearDeviceCache(): void {
  cache = null;
}
