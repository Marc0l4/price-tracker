import type { NormalizedProduct } from "../types/normalized-product.js";
import type { ProductMatchResult } from "./product-match-result.js";
import {
  essentialName, extractBundleMarkers, extractColors, extractCondition, extractMemory,
  extractSize, extractVersions, modelTokens, normalizedBrand, titleQualifiers, validGtin,
} from "./product-normalizer.js";

const same = (left: string[], right: string[]) => left.join("|") === right.join("|");
const overlaps = (left: string[], right: string[]) => left.some((token) => right.includes(token));

export class ProductMatcher {
  compare(left: NormalizedProduct, right: NormalizedProduct): ProductMatchResult {
    let score = 0;
    let positiveVariantEvidence = false;
    let partialVariantEvidence = false;
    const reasons: string[] = [];
    const conflicts: string[] = [];
    const missingEvidence: string[] = [];
    const add = (points: number, reason: string) => { score += points; reasons.push(reason); };
    const compareVariant = (label: string, a: string[], b: string[], points: number) => {
      if (!a.length && !b.length) { missingEvidence.push(`${label} ausente em ambos`); return; }
      if (!a.length || !b.length) {
        partialVariantEvidence = true;
        missingEvidence.push(`${label} ausente em um lado`);
        return;
      }
      if (!same(a, b)) conflicts.push(`${label} diferente`);
      else { positiveVariantEvidence = true; add(points, `${label} igual`); }
    };

    const leftGtin = validGtin(left.gtin);
    const rightGtin = validGtin(right.gtin);
    const gtinEqual = Boolean(leftGtin && rightGtin && leftGtin === rightGtin);
    if (leftGtin && rightGtin) {
      if (gtinEqual) add(100, "GTIN válido igual");
      else conflicts.push("GTIN válido diferente");
    } else missingEvidence.push("GTIN válido ausente em um ou ambos");

    const leftBrand = normalizedBrand(left);
    const rightBrand = normalizedBrand(right);
    if (leftBrand && rightBrand) {
      if (leftBrand === rightBrand) add(20, "marca igual");
      else conflicts.push("marca diferente");
    } else missingEvidence.push("marca ausente em um ou ambos");

    const leftMemory = extractMemory(`${left.name} ${left.model ?? ""}`);
    const rightMemory = extractMemory(`${right.name} ${right.model ?? ""}`);
    compareVariant("capacidade", leftMemory.storage, rightMemory.storage, 30);
    compareVariant("RAM", leftMemory.ram, rightMemory.ram, 15);
    compareVariant("cor", extractColors(left.name), extractColors(right.name), 10);
    compareVariant("tamanho", extractSize(left.name), extractSize(right.name), 20);

    const leftVersions = extractVersions(`${left.name} ${left.model ?? ""}`);
    const rightVersions = extractVersions(`${right.name} ${right.model ?? ""}`);
    if (!same(leftVersions, rightVersions)) conflicts.push("modelo ou versão diferente");

    const leftBundles = extractBundleMarkers(left.name);
    const rightBundles = extractBundleMarkers(right.name);
    if (!same(leftBundles, rightBundles)) conflicts.push("kit ou acessório diferente");

    const leftCondition = extractCondition(left.name);
    const rightCondition = extractCondition(right.name);
    if (leftCondition !== rightCondition) conflicts.push("condição diferente");
    if (!leftCondition && !rightCondition) missingEvidence.push("condição ausente em ambos");

    const leftModel = modelTokens(left);
    const rightModel = modelTokens(right);
    const modelEqual = leftModel.length > 0 && same(leftModel, rightModel);
    if (modelEqual) add(40, "modelo essencial igual");
    else if (leftModel.length && rightModel.length && (left.model && right.model || overlaps(leftModel, rightModel)))
      conflicts.push("modelo ou versão diferente");

    if (!same(titleQualifiers(left), titleQualifiers(right)))
      conflicts.push("qualificador de título diferente");
    if (essentialName(left) === essentialName(right)) add(20, "nome essencial equivalente");

    const matched = conflicts.length === 0 && (gtinEqual ||
      modelEqual && positiveVariantEvidence && !partialVariantEvidence && score >= 70);
    const confidence = !matched ? "low" : gtinEqual ||
      score >= 100 && leftMemory.storage.length > 0 && rightMemory.storage.length > 0 &&
      extractColors(left.name).length > 0 && extractColors(right.name).length > 0 ? "high" : "medium";
    return { matched, confidence, score, reasons, conflicts: [...new Set(conflicts)], missingEvidence };
  }
}
