import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProductPage } from "@/app/products/[id]/product-page";
import { getAnalytics, getHistory, getOffers, getProduct } from "@/lib/api/products";

vi.mock("next/link", () => ({ default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a> }));
vi.mock("@/lib/api/products", () => ({ getAnalytics: vi.fn(), getHistory: vi.fn(), getOffers: vi.fn(), getProduct: vi.fn() }));

const product = { id: "11111111-1111-4111-8111-111111111111", name: "Apple iPhone 15", brand: "Apple", model: "128GB", gtin: null, matchStatus: "review_required" as const, imageUrl: null, providers: ["amazon"], activeOffers: [] };
const analytics = { currency: "BRL", currentPrice: "3599.9000", lowestPrice: "3499.0000", lowestPriceAt: "2026-10-01T12:00:00.000Z", highestPrice: "4000.0000", averagePrice: "3929.0000", observationCount: 8, firstObservedAt: "2026-09-01T12:00:00.000Z", lastObservedAt: "2026-11-01T12:00:00.000Z", percentFromAverage: "-8.4000", classification: "low" as const };
const history = { currency: "BRL", granularity: "raw" as const, from: null, to: null, points: [{ periodStart: "2026-11-01T12:00:00.000Z", periodEnd: "2026-11-01T12:00:00.000Z", minPrice: "3599.9000", maxPrice: "3599.9000", averagePrice: "3599.9000", lastPrice: "3599.9000", lastObservedAt: "2026-11-01T12:00:00.000Z", observationCount: 1 }] };
const offers = { offers: [{ id: "offer", provider: "amazon", storeName: "Amazon", productUrl: "https://example.test/product", availability: "available", shippingIsFree: true, lastSeenAt: "2026-11-01T12:00:00.000Z", currency: "BRL", price: "3599.9000", observedAt: "2026-11-01T12:00:00.000Z" }], bestOffers: [{ id: "offer", provider: "amazon", storeName: "Amazon", productUrl: "https://example.test/product", availability: "available", shippingIsFree: true, lastSeenAt: "2026-11-01T12:00:00.000Z", currency: "BRL", price: "3599.9000", observedAt: "2026-11-01T12:00:00.000Z" }] };

describe("fluxo da página de produto", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(getProduct).mockResolvedValue(product); vi.mocked(getOffers).mockResolvedValue(offers); vi.mocked(getAnalytics).mockResolvedValue(analytics); vi.mocked(getHistory).mockResolvedValue(history); });
  it("carrega produto, analytics, histórico e ofertas da API", async () => { render(<ProductPage id={product.id} />); expect(await screen.findByRole("heading", { name: product.name })).toBeInTheDocument(); expect(screen.getByText("Preço baixo")).toBeInTheDocument(); expect(screen.getByText(/menor preço/i)).toBeInTheDocument(); expect(screen.getByText(/melhor preço atual/i)).toBeInTheDocument(); expect(screen.getByText(/processo de validação/i)).toBeInTheDocument(); expect(getProduct).toHaveBeenCalledWith(product.id); expect(getOffers).toHaveBeenCalledWith(product.id); });
  it("troca o período sem recarregar detalhe ou ofertas", async () => { render(<ProductPage id={product.id} />); await screen.findByRole("heading", { name: product.name }); expect(getHistory).toHaveBeenCalledWith(product.id, "90d"); fireEvent.click(screen.getByRole("button", { name: "30 dias" })); await waitFor(() => expect(getHistory).toHaveBeenLastCalledWith(product.id, "30d")); expect(getProduct).toHaveBeenCalledTimes(1); expect(getOffers).toHaveBeenCalledTimes(1); });
  it("mostra mensagem amigável para produto inexistente", async () => { vi.mocked(getProduct).mockRejectedValue({ status: 404 }); render(<ProductPage id={product.id} />); expect(await screen.findByText("Produto não encontrado")).toBeInTheDocument(); });
  it("não mostra percentual quando o backend informa histórico insuficiente", async () => {
    vi.mocked(getAnalytics).mockResolvedValue({ ...analytics, observationCount: 1, percentFromAverage: null, classification: "insufficient_data" });
    render(<ProductPage id={product.id} />);
    expect(await screen.findByText("Histórico insuficiente")).toBeInTheDocument();
    expect(screen.queryByText(/abaixo da média histórica/i)).not.toBeInTheDocument();
  });
});
