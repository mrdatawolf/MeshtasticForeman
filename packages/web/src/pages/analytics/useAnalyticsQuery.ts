import { useCallback, useEffect, useRef, useState } from "react";

export interface AnalyticsQueryState<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
  refresh: () => void;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}

export function useAnalyticsQuery<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  dependencies: readonly unknown[],
  fallbackData?: T,
): AnalyticsQueryState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshToken, setRefreshToken] = useState(0);
  const controllerRef = useRef<AbortController | null>(null);
  const requestRef = useRef(0);

  const refresh = useCallback(() => setRefreshToken((token) => token + 1), []);

  useEffect(() => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const request = ++requestRef.current;

    setData(null);
    setError(null);
    setLoading(true);

    fetcher(controller.signal).then(
      (result) => {
        if (!controller.signal.aborted && request === requestRef.current) {
          setData(result);
          setLoading(false);
        }
      },
      (reason: unknown) => {
        if (controller.signal.aborted || isAbortError(reason) || request !== requestRef.current)
          return;
        setError(reason instanceof Error ? reason : new Error(String(reason)));
        if (fallbackData !== undefined) setData(fallbackData);
        setLoading(false);
      },
    );

    return () => controller.abort();
    // The caller supplies the semantic query dependencies; fetchers are intentionally
    // excluded so inline closures do not restart a request after every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependencies, refreshToken]);

  return { data, error, loading, refresh };
}
