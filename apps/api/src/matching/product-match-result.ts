export interface ProductMatchResult {
  matched: boolean;
  confidence: "high" | "medium" | "low";
  score: number;
  reasons: string[];
  conflicts: string[];
  missingEvidence: string[];
}

export interface ProductGroup<T> {
  id: string;
  products: T[];
}
