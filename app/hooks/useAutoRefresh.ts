import { useRef } from "react";
import { Minute } from "@shared/utils/time";
import Logger from "~/utils/Logger";
import useIdle from "./useIdle";
import useInterval from "./useInterval";

// The case of isReloaded=true should never be hit as the app will reload
// before the hook is called again, however seems like the only possible
// cause of #5384, adding to debug.
let isReloaded = false;

/**
 * Hook to reload the app around once a day to stop old code from running.
 */
export default function useAutoRefresh() {
  // A ref rather than state so that the once-a-minute tick does not re-render
  // the entire route tree this hook is mounted within.
  const elapsedMinutes = useRef(0);
  const isIdle = useIdle(5 * Minute.ms);

  useInterval(() => {
    elapsedMinutes.current += 1;

    if (elapsedMinutes.current >= 60 * 24) {
      if (!isIdle) {
        Logger.debug("lifecycle", "Skipping reload due to user activity");
        return;
      }
      if (isReloaded) {
        Logger.warn("Attempted to reload twice");
      }

      Logger.debug("lifecycle", "Auto-reloading app…");
      window.location.reload();
      isReloaded = true;
    }
  }, Minute.ms);
}
