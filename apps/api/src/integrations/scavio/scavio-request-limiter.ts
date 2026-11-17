/** Serializa operações por chave neste processo, sem acoplar o serviço de busca. */
export class ScavioRequestLimiter {
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(key: string, operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const previous = this.tails.get(key);
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.tails.set(key, current);

    try {
      if (previous) await this.waitFor(previous, signal);
      signal?.throwIfAborted();
      return await operation();
    } finally {
      release();
      if (this.tails.get(key) === current) this.tails.delete(key);
    }
  }

  private async waitFor(previous: Promise<void>, signal?: AbortSignal): Promise<void> {
    if (!signal) return previous;
    if (signal.aborted) signal.throwIfAborted();
    await Promise.race([
      previous,
      new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason ?? new DOMException("Aborted", "AbortError")), { once: true })),
    ]);
  }
}

export const scavioRequestLimiter = new ScavioRequestLimiter();
