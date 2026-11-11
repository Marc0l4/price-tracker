import type { NormalizedOffer, NormalizedProduct } from "../types/normalized-product.js";
import { isDeepStrictEqual } from "node:util";
import type { SourcedProduct } from "./persistence-contracts.js";
import type { PersistenceUnitFailure } from "./persistence-result.js";

const productKey = (provider: string, externalId: string) => JSON.stringify([provider, externalId]);
const offerKey = (offer: NormalizedOffer) => JSON.stringify([offer.provider, offer.externalOfferId]);
const same = (left: unknown, right: unknown) => isDeepStrictEqual(left, right);

function comparableProduct(product: NormalizedProduct) {
  const { offers: _offers, ...identity } = product;
  return identity;
}

function validate(input: SourcedProduct): string | undefined {
  if (!input.provider.trim()) return "Provider é obrigatório.";
  if (!input.product.externalId.trim()) return "externalId é obrigatório.";
  if (!input.product.name.trim()) return "Nome do produto é obrigatório.";
  for (const offer of input.product.offers) {
    if (offer.provider !== input.provider) return "A origem da oferta diverge da origem do produto.";
    if (!offer.externalOfferId.trim()) return "externalOfferId é obrigatório.";
    if (!Number.isFinite(offer.price) || offer.price <= 0) return "Preço deve ser maior que zero.";
    if (!/^[A-Z]{3}$/.test(offer.currency)) return "Moeda deve usar três letras maiúsculas.";
  }
  return undefined;
}

export function normalizeBatch(inputs: SourcedProduct[]): {
  inputs: SourcedProduct[];
  failures: PersistenceUnitFailure[];
} {
  const consolidated = new Map<string, SourcedProduct>();
  const failures: PersistenceUnitFailure[] = [];
  const invalidKeys = new Set<string>();

  for (const source of inputs) {
    const provider = source.provider.trim();
    const externalId = source.product.externalId.trim();
    const key = productKey(provider, externalId);
    const normalized: SourcedProduct = {
      provider,
      product: {
        ...source.product,
        externalId,
        offers: source.product.offers.map((offer) => ({ ...offer, externalOfferId: offer.externalOfferId.trim() })),
      },
    };
    const validationError = validate(normalized);
    if (validationError) {
      invalidKeys.add(key);
      consolidated.delete(key);
      failures.push({ productKeys: [key], code: "validation_error", message: validationError });
      continue;
    }
    if (invalidKeys.has(key)) continue;
    const existing = consolidated.get(key);
    if (!existing) {
      consolidated.set(key, normalized);
      continue;
    }
    if (!same(comparableProduct(existing.product), comparableProduct(normalized.product))) {
      invalidKeys.add(key);
      consolidated.delete(key);
      failures.push({ productKeys: [key], code: "duplicate_conflict",
        message: "O mesmo produto externo apareceu com identidades conflitantes na coleta." });
      continue;
    }
    const offers = new Map(existing.product.offers.map((offer) => [offerKey(offer), offer]));
    let conflict = false;
    for (const offer of normalized.product.offers) {
      const previous = offers.get(offerKey(offer));
      if (previous && !same(previous, offer)) { conflict = true; break; }
      offers.set(offerKey(offer), offer);
    }
    if (conflict) {
      invalidKeys.add(key);
      consolidated.delete(key);
      failures.push({ productKeys: [key], code: "duplicate_conflict",
        message: "A mesma oferta apareceu com valores conflitantes na coleta." });
    } else existing.product.offers = [...offers.values()];
  }

  return { inputs: [...consolidated.values()], failures };
}

export { productKey };
