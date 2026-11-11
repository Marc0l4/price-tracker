import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OffersList } from "@/components/offers-list";
import { chartData, PriceChart } from "@/components/price-chart";
import { ProductCard } from "@/components/product-card";
import { ProductImage } from "@/components/product-image";
import { classificationLabel, formatMoney, percentageLabel, safeExternalUrl } from "@/lib/formatting";
import type { HistoryResponse, Offer, ProductSummary } from "@/lib/types/api";

vi.mock("next/link", () => ({ default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a> }));

const product: ProductSummary = { id: "p1", name: "Apple iPhone 15", brand: "Apple", model: "128GB", matchStatus: "confirmed", imageUrl: null, currentPrice: "3599.9000", currency: "BRL" };
const offer: Offer = { id: "o1", provider: "amazon", storeName: "Amazon", productUrl: "https://example.test/product", availability: "available", shippingIsFree: true, lastSeenAt: "2026-11-09T12:00:00.000Z", currency: "BRL", price: "3599.9000", observedAt: "2026-11-09T12:00:00.000Z" };
const history: HistoryResponse = { currency: "BRL", granularity: "day", from: null, to: null, points: [{ periodStart: "2026-11-01T00:00:00.000Z", periodEnd: "2026-11-01T23:59:59.000Z", minPrice: "3500.0000", maxPrice: "3700.0000", averagePrice: "3600.0000", lastPrice: "3599.9000", lastObservedAt: "2026-11-01T20:00:00.000Z", observationCount: 2 }] };

describe("componentes de produto", () => {
  it("mostra nome, preço formatado e link no ProductCard", () => { render(<ProductCard product={product} />); expect(screen.getByRole("link", { name: /apple iphone 15/i })).toHaveAttribute("href", "/products/p1"); expect(screen.getByText(/R\$\s*3\.599,90/)).toBeInTheDocument(); });
  it("mostra preço indisponível em vez de zero", () => { render(<ProductCard product={{ ...product, currentPrice: null, currency: null }} />); expect(screen.getByText("Preço indisponível")).toBeInTheDocument(); expect(screen.queryByText("R$ 0,00")).not.toBeInTheDocument(); });
  it("usa fallback acessível quando a imagem não está disponível ou falha", () => { const { rerender } = render(<ProductImage src={null} alt="iPhone" />); expect(screen.getByRole("img", { name: "Imagem indisponível: iPhone" })).toBeInTheDocument(); rerender(<ProductImage src="https://example.test/iphone.jpg" alt="iPhone" />); fireEvent.error(screen.getByRole("img", { name: "iPhone" })); expect(screen.getByRole("img", { name: "Imagem indisponível: iPhone" })).toBeInTheDocument(); });
  it("comunica produto em revisão", () => { render(<ProductCard product={{ ...product, matchStatus: "review_required" }} />); expect(screen.getByText(/processo de validação/i)).toBeInTheDocument(); });
  it("formata BRL e labels de classificação de forma amigável", () => { expect(formatMoney("3599.9", "BRL")).toMatch(/R\$\s*3\.599,90/); expect(classificationLabel("low")).toBe("Preço baixo"); expect(classificationLabel("normal")).toBe("Preço normal"); expect(classificationLabel("high")).toBe("Preço alto"); expect(classificationLabel("insufficient_data")).toBe("Histórico insuficiente"); expect(percentageLabel("-8.4")).toContain("abaixo"); });
  it("destaca a melhor oferta e abre URL externa protegida", () => { render(<OffersList offers={[offer]} bestOffers={[offer]} />); expect(screen.getByText("Melhor preço atual")).toBeInTheDocument(); const link = screen.getByRole("link", { name: /ver oferta/i }); expect(link).toHaveAttribute("target", "_blank"); expect(link).toHaveAttribute("rel", "noopener noreferrer"); });
  it("não renderiza oferta inativa que não vem da API de ofertas atuais", () => { render(<OffersList offers={[]} bestOffers={[]} />); expect(screen.getByText(/nenhuma oferta ativa/i)).toBeInTheDocument(); });
  it("recusa URL externa com protocolo inseguro", () => { expect(safeExternalUrl("javascript:alert(1)")).toBeUndefined(); });
  it("mostra estado vazio para histórico ausente", () => { render(<PriceChart history={{ ...history, points: [] }} />); expect(screen.getByText(/ainda não temos histórico suficiente/i)).toBeInTheDocument(); });
  it("renderiza gráfico para pontos brutos ou agregados", () => { render(<PriceChart history={history} />); expect(screen.getByRole("img", { name: /gráfico de histórico/i })).toBeInTheDocument(); });
  it("preserva cada preço bruto recente no dataset enviado ao Recharts", () => {
    const rawHistory: HistoryResponse = {
      ...history,
      granularity: "raw",
      points: ["3779.0000", "4650.0000", "3779.0900", "4280.0000"].map((lastPrice) => ({
        ...history.points[0],
        lastPrice,
        minPrice: lastPrice,
        maxPrice: lastPrice,
        averagePrice: lastPrice,
        periodStart: "2026-11-09T12:00:00.000Z",
        lastObservedAt: "2026-11-09T12:00:00.000Z",
      })),
    };
    const data = chartData(rawHistory);
    expect(data).toHaveLength(4);
    expect(new Set(data.map((point) => point.coordinate))).toHaveLength(4);
    expect(new Set(data.map((point) => point.value))).toHaveLength(4);
  });
});
