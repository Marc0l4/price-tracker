import type { MatchStatus } from "../generated/prisma/client.js";

export type PersistenceFailureCode =
  | "validation_error"
  | "duplicate_conflict"
  | "identity_conflict"
  | "database_conflict"
  | "transaction_timeout"
  | "database_unavailable"
  | "persistence_error";

export interface PersistenceUnitSuccess {
  groupId: string;
  productKeys: string[];
  canonicalProductIds: string[];
  matchStatus: MatchStatus;
}

export interface PersistenceUnitFailure {
  groupId?: string;
  productKeys: string[];
  code: PersistenceFailureCode;
  message: string;
}

export interface ProviderLifecycleResult {
  provider: string;
  status: "updated" | "skipped_due_to_failure";
  inactiveOffers: number;
}

export interface PersistenceBatchResult {
  succeeded: PersistenceUnitSuccess[];
  failed: PersistenceUnitFailure[];
  providerLifecycle: ProviderLifecycleResult[];
}
