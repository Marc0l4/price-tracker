import type { PriceClassification } from "./types/api";

export function formatMoney(value: string | null, currency = "BRL"): string {
  if (value === null) return "Preço indisponível";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(value));
}
export function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(new Date(value));
}
export function classificationLabel(value: PriceClassification): string {
  return { low: "Preço baixo", normal: "Preço normal", high: "Preço alto", insufficient_data: "Histórico insuficiente" }[value];
}
export function percentageLabel(value: string | null): string | null {
  if (value === null) return null;
  const number = Number(value);
  return `${number < 0 ? "↓" : number > 0 ? "↑" : "•"} ${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1, signDisplay: "never" }).format(Math.abs(number))}% ${number < 0 ? "abaixo" : number > 0 ? "acima" : "na"} média histórica`;
}
export function safeExternalUrl(value: string): string | undefined {
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) ? url.toString() : undefined; } catch { return undefined; }
}
