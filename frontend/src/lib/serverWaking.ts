import { useSyncExternalStore } from "react";
import { SLOW_REQUEST_MS } from "@/constants";

let slowCount = 0;
const listeners = new Set<() => void>();

function change(delta: number) {
  slowCount += delta;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isServerWaking(): boolean {
  return slowCount > 0;
}

export async function trackSlow<T>(promise: Promise<T>): Promise<T> {
  let slow = false;
  const timer = setTimeout(() => {
    slow = true;
    change(1);
  }, SLOW_REQUEST_MS);
  try {
    return await promise;
  } finally {
    clearTimeout(timer);
    if (slow) change(-1);
  }
}

export function useServerWaking(): boolean {
  return useSyncExternalStore(subscribe, isServerWaking);
}
