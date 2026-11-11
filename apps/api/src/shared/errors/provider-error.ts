import type { ProviderSearchError } from "../../types/normalized-product.js";

export class ProviderError extends Error {
  constructor(
    public readonly provider: string,
    public readonly code: ProviderSearchError["code"],
    message: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }

  toSearchError(): ProviderSearchError {
    return { provider: this.provider, code: this.code, message: this.message };
  }
}
