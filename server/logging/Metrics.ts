/**
 * Metrics sink for application instrumentation.
 *
 * The StatsD sink has been removed; these methods remain as no-ops so
 * existing call sites stay stable.
 */
class Metrics {
  /**
   * Record a gauge value.
   *
   * @param key The metric name.
   * @param value The metric value.
   * @param tags Optional tags associated with the measurement.
   */
  gauge(_key: string, _value: number, _tags?: string[]): void {}

  /**
   * Record a gauge value tagged with the current instance identifier.
   *
   * @param key The metric name.
   * @param value The metric value.
   * @param tags Optional tags associated with the measurement.
   */
  gaugePerInstance(_key: string, _value: number, _tags: string[] = []): void {}

  /**
   * Increment a counter.
   *
   * @param key The metric name.
   * @param tags Optional tags associated with the increment.
   */
  increment(_key: string, _tags?: Record<string, string>): void {}

  /**
   * Flush any pending metrics.
   *
   * @return A promise that resolves immediately.
   */
  flush(): Promise<void> {
    return Promise.resolve();
  }
}

export default new Metrics();
