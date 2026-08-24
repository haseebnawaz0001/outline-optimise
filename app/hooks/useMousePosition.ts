import { useState, useMemo, useEffect, useRef } from "react";
import useEventListener from "./useEventListener";

/**
 * Mouse position as a tuple of [x, y]
 */
type MousePosition = [number, number];

/**
 * Hook to get the current mouse position
 *
 * @returns Mouse position as a tuple of [x, y]
 */
export const useMousePosition = () => {
  const [mousePosition, setMousePosition] = useState<MousePosition>([0, 0]);
  // The latest observed coordinates; mousemove events are coalesced so at most
  // one state update happens per animation frame.
  const position = useRef<MousePosition>([0, 0]);
  const frame = useRef<number>();

  const updateMousePosition = useMemo(
    () => (ev: MouseEvent) => {
      position.current = [ev.clientX, ev.clientY];

      if (frame.current !== undefined) {
        return;
      }

      frame.current = requestAnimationFrame(() => {
        frame.current = undefined;
        setMousePosition(position.current);
      });
    },
    []
  );

  useEffect(
    () => () => {
      if (frame.current !== undefined) {
        cancelAnimationFrame(frame.current);
        frame.current = undefined;
      }
    },
    []
  );

  useEventListener("mousemove", updateMousePosition, undefined, {
    passive: true,
  });

  return mousePosition;
};
