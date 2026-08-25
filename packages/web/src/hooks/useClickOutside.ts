import { useEffect, useRef } from "react";

import type { RefObject } from "react";

export function useClickOutside(
  ref: RefObject<HTMLElement | null>,
  onOutside: () => void,
  enabled: boolean,
) {
  const onOutsideRef = useRef(onOutside);

  useEffect(() => {
    onOutsideRef.current = onOutside;
  }, [onOutside]);

  useEffect(() => {
    if (!enabled) return;

    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onOutsideRef.current();
      }
    };

    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [enabled, ref]);
}
