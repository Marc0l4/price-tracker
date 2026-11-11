import type { CollectionLogger } from "./collection-contracts.js";

/** The only default console boundary for collection diagnostics. */
export class StructuredCollectionLogger implements CollectionLogger {
  info(event: string, fields: Record<string, string | number | boolean | undefined>): void {
    console.info(JSON.stringify({ event, ...fields }));
  }
}

export const noopCollectionLogger: CollectionLogger = { info: () => undefined };
