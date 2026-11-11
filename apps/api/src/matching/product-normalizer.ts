import type { NormalizedProduct } from "../types/normalized-product.js";

export function normalizeText(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/(\d)\s*(gb|tb)\b/g, "$1 $2")
    .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

const colors: Record<string, string> = {
  preto: "preto", black: "preto", azul: "azul", blue: "azul",
  branco: "branco", white: "branco", verde: "verde", green: "verde",
  vermelho: "vermelho", red: "vermelho", rosa: "rosa", pink: "rosa",
  dourado: "dourado", gold: "dourado", prata: "prata", silver: "prata",
  cinza: "cinza", gray: "cinza", grey: "cinza", roxo: "roxo", purple: "roxo",
  midnight: "midnight", starlight: "starlight",
};
const knownBrands = ["apple", "samsung"];
const versions = new Set(["pro", "max", "plus", "mini", "fe", "ultra", "slim", "lite", "se"]);
const bundleWords = new Set(["kit", "bundle", "combo", "pack", "conjunto", "capa", "carregador", "pelicula", "suporte", "case"]);
const conditions: Record<string, string> = {
  novo: "novo", new: "novo", usado: "usado", used: "usado",
  seminovo: "seminovo", recondicionado: "recondicionado", refurbished: "recondicionado",
};
const unique = (values: string[]) => [...new Set(values)].sort();

export function extractMemory(value: string): { storage: string[]; ram: string[] } {
  const text = normalizeText(value);
  const storage: string[] = [];
  const ram: string[] = [];
  for (const match of text.matchAll(/\b(\d+) (gb|tb)\b/g)) {
    const amount = Number(match[1]);
    const normalized = match[2] === "tb" && amount === 1 || match[2] === "gb" && amount === 1024
      ? "1tb" : `${amount}${match[2]}`;
    const before = text.slice(Math.max(0, match.index - 16), match.index).trim().split(" ").at(-1);
    const after = text.slice(match.index + match[0].length).trim().split(" ")[0];
    if (after === "ram") ram.push(normalized);
    else if (["ssd", "storage", "armazenamento", "rom"].includes(after)) storage.push(normalized);
    else if (before === "ram") ram.push(normalized);
    else if (["ssd", "storage", "armazenamento", "rom"].includes(before ?? "")) storage.push(normalized);
    else if (match[2] === "tb" && amount === 1 || match[2] === "gb" && [64, 128, 256, 512, 1024].includes(amount))
      storage.push(normalized);
  }
  return { storage: unique(storage), ram: unique(ram) };
}

export const extractCapacity = (value: string): string[] => extractMemory(value).storage;

export function extractColors(value: string): string[] {
  return unique(normalizeText(value).split(" ").map((token) => colors[token]).filter((color): color is string => Boolean(color)));
}

export function extractVersions(value: string): string[] {
  const text = normalizeText(value);
  const found = text.split(" ").filter((token) => versions.has(token));
  for (const match of text.matchAll(/\b(?:geracao|generation|gen) (\d+)\b|\b(\d+)(?:a|nd|rd|th)? (?:geracao|generation|gen)\b/g))
    found.push(`generation:${match[1] ?? match[2]}`);
  return unique(found);
}

export function extractSize(value: string): string[] {
  const raw = value.toLowerCase();
  const found = [...raw.matchAll(/\b(\d{1,3}(?:[.,]\d+)?)[\s-]*(?:["″”]|polegadas?\b|inches?\b|inch\b)/g)]
    .map((match) => `${Number(match[1].replace(",", "."))}in`);
  return unique(found);
}

export function extractBundleMarkers(value: string): string[] {
  const text = normalizeText(value);
  const found = text.split(" ").filter((token) => bundleWords.has(token));
  if (text.includes("com acessorios")) found.push("com acessorios");
  return unique(found);
}

export function extractCondition(value: string): string | undefined {
  return unique(normalizeText(value).split(" ").map((token) => conditions[token]).filter((condition): condition is string => Boolean(condition))).join("|") || undefined;
}

export function normalizedBrand(product: NormalizedProduct): string | undefined {
  if (product.brand?.trim()) return normalizeText(product.brand);
  return knownBrands.find((brand) => normalizeText(product.name).split(" ").includes(brand));
}

function withoutNoise(value: string): string {
  return normalizeText(value).replace(/\bdistribuidor autorizado\b/g, " ").replace(/\s+/g, " ").trim();
}

export function essentialName(product: NormalizedProduct): string {
  return withoutNoise(product.name).split(" ").filter(Boolean).sort().join(" ");
}

function identityTokens(value: string, product: NormalizedProduct): string[] {
  const source = withoutNoise(value);
  const brand = normalizedBrand(product)?.split(" ") ?? [];
  const excluded = new Set([...brand, ...knownBrands, ...Object.keys(colors), ...versions,
    ...bundleWords, ...Object.keys(conditions), "gb", "tb", "ram", "ssd", "storage", "armazenamento", "rom",
    "com", "acessorios", "polegadas", "polegada", "inch", "inches", "generation", "geracao", "gen"]);
  const numbers = new Set([...source.matchAll(/\b\d+ (?:gb|tb|polegadas?|inches?|inch)\b/g)].map((match) => match[0].split(" ")[0]));
  for (const size of extractSize(value)) numbers.add(size.replace(/in$/, ""));
  return source.split(" ").filter((token) => token && !excluded.has(token) && !numbers.has(token)).sort();
}

export function modelTokens(product: NormalizedProduct): string[] {
  return identityTokens(product.model?.trim() || product.name, product);
}

export function titleQualifiers(product: NormalizedProduct): string[] {
  if (!product.model?.trim()) return [];
  const title = identityTokens(product.name, product);
  const model = identityTokens(product.model, product);
  return title.filter((token) => !model.includes(token));
}

export function validGtin(value: string | undefined): string | undefined {
  if (!value || !/^\d[\d\s-]*\d$/.test(value.trim())) return undefined;
  const digits = value.replace(/[\s-]/g, "");
  if (!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(digits)) return undefined;
  const check = Number(digits.at(-1));
  const sum = [...digits.slice(0, -1)].reverse().reduce((total, digit, index) =>
    total + Number(digit) * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - sum % 10) % 10 === check ? digits : undefined;
}
