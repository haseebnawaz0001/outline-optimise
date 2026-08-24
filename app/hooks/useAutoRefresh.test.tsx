import { act } from "react-dom/test-utils";
import ReactDOM from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Minute } from "@shared/utils/time";
import useAutoRefresh from "./useAutoRefresh";

vi.mock("~/utils/Logger", () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

let renders = 0;

function Probe() {
  renders += 1;
  useAutoRefresh();
  return null;
}

describe("useAutoRefresh", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    renders = 0;
  });

  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    document.body.removeChild(container);
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("does not re-render the host component on each minute tick", () => {
    act(() => {
      ReactDOM.render(<Probe />, container);
    });
    expect(renders).toBe(1);

    // Advance past useIdle's time-to-idle so its one-off state transition
    // settles; this accounts for a single re-render.
    act(() => {
      vi.advanceTimersByTime(10 * Minute.ms);
    });
    const settledRenders = renders;
    expect(settledRenders).toBeLessThanOrEqual(2);

    // Fifty further minute ticks must not cause any additional re-renders.
    act(() => {
      vi.advanceTimersByTime(50 * Minute.ms);
    });
    expect(renders).toBe(settledRenders);
  });

  it("reaches the reload threshold after a day of ticks", async () => {
    act(() => {
      ReactDOM.render(<Probe />, container);
    });

    // Advance past useIdle's time-to-idle in its own act() call so the idle
    // state transition renders before further time advances.
    act(() => {
      vi.advanceTimersByTime(10 * Minute.ms);
    });

    // A day of further ticks crosses the reload threshold while idle.
    // jsdom cannot intercept window.location.reload, so assert on the debug
    // log emitted immediately before the reload instead.
    act(() => {
      vi.advanceTimersByTime(60 * 24 * Minute.ms);
    });

    const { default: Logger } = await import("~/utils/Logger");
    expect(Logger.debug).toHaveBeenCalledWith(
      "lifecycle",
      "Auto-reloading app…"
    );
  });
});
