import { JINA_TIMEOUT_MS } from "../constants.js";

export function withTimeout(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(JINA_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
