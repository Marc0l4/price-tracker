import type { CollectionLogger } from "./collection-contracts.js";
import { StructuredCollectionLogger } from "./collection-logger.js";

export interface ScheduledCollectionPort {
  runScheduled(): Promise<unknown>;
  recoverInterruptedRuns(): Promise<number>;
}

export class CollectionScheduler {
  private timer: NodeJS.Timeout | undefined;
  private ticking = false;

  constructor(
    private readonly orchestrator: ScheduledCollectionPort,
    private readonly intervalMs: number,
    private readonly logger: CollectionLogger = new StructuredCollectionLogger(),
  ) {
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new Error("Intervalo do scheduler deve ser positivo.");
  }

  async start(): Promise<boolean> {
    if (this.timer) return false;
    await this.orchestrator.recoverInterruptedRuns();
    this.timer = setInterval(() => { void this.tick(); }, this.intervalMs);
    this.timer.unref();
    return true;
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick(): Promise<boolean> {
    if (this.ticking) {
      this.logger.info("scheduler.skipped_overlap", {});
      return false;
    }
    this.ticking = true;
    try {
      await this.orchestrator.runScheduled();
      return true;
    } catch {
      this.logger.info("scheduler.failed", {});
      return false;
    } finally {
      this.ticking = false;
    }
  }
}
