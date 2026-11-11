import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HomePage } from "@/app/home-page";
import { SearchStateProvider } from "@/app/search-state-provider";
import { searchProducts } from "@/lib/api/products";

vi.mock("next/link", () => ({ default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a> }));
vi.mock("@/lib/api/products", () => ({ searchProducts: vi.fn() }));

const product = { id: "p1", name: "iPhone", brand: null, model: null, matchStatus: "confirmed" as const, imageUrl: null, currentPrice: "3500.0000", currency: "BRL" };

function submitSearch(value: string) {
  fireEvent.change(screen.getByLabelText("Buscar produto"), { target: { value } });
  fireEvent.submit(screen.getByRole("button", { name: "Buscar" }).closest("form")!);
}

function renderHome() { return render(<SearchStateProvider><HomePage /></SearchStateProvider>); }

describe("busca de produtos", () => {
  beforeEach(() => {
    vi.mocked(searchProducts).mockReset();
    window.history.replaceState(null, "", "/");
  });

  it("não chama a API para busca vazia e oferece estado inicial", () => {
    renderHome();
    expect(searchProducts).not.toHaveBeenCalled();
    expect(screen.getByText(/encontre um produto/i)).toBeInTheDocument();
  });

  it("busca resultados persistidos e pagina dentro da sessão", async () => {
    vi.mocked(searchProducts)
      .mockResolvedValueOnce({ page: 1, limit: 20, total: 21, items: [product] })
      .mockResolvedValueOnce({ page: 2, limit: 20, total: 21, items: [product] });
    renderHome();
    submitSearch("iphone");
    expect(await screen.findByText("iPhone")).toBeInTheDocument();
    expect(searchProducts).toHaveBeenLastCalledWith("iphone", 1, "history");
    expect(window.location.search).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    await waitFor(() => expect(searchProducts).toHaveBeenLastCalledWith("iphone", 2, "history"));
    expect(screen.getByText("Página 2 de 2")).toBeInTheDocument();
  });

  it("limpa URL, campo e resultados ao montar uma nova página inicial", async () => {
    window.history.replaceState(null, "", "/?q=iphone&page=2");
    renderHome();
    await waitFor(() => expect(window.location.pathname + window.location.search).toBe("/"));
    expect(screen.getByLabelText("Buscar produto")).toHaveValue("");
    expect(screen.getByText(/encontre um produto/i)).toBeInTheDocument();
    expect(searchProducts).not.toHaveBeenCalled();
  });

  it("informa ausência de resultados", async () => {
    vi.mocked(searchProducts).mockResolvedValue({ page: 1, limit: 20, total: 0, items: [] });
    renderHome();
    submitSearch("inexistente");
    expect(await screen.findByText(/nenhum produto encontrado/i)).toBeInTheDocument();
  });

  it("trata falha de busca sem expor detalhes internos", async () => {
    vi.mocked(searchProducts).mockRejectedValue(new Error("sql detail"));
    renderHome();
    submitSearch("iphone");
    expect(await screen.findByText(/não foi possível carregar os dados agora/i)).toBeInTheDocument();
    expect(screen.queryByText(/sql detail/i)).not.toBeInTheDocument();
  });

  it("preserva query, resultados, página e ordenação ao voltar do produto", async () => {
    vi.mocked(searchProducts)
      .mockResolvedValueOnce({ page: 1, limit: 20, total: 21, items: [product] })
      .mockResolvedValueOnce({ page: 1, limit: 20, total: 21, items: [product] })
      .mockResolvedValueOnce({ page: 2, limit: 20, total: 21, items: [product] });
    const view = renderHome();
    submitSearch("iphone");
    await screen.findByText("iPhone");
    fireEvent.change(screen.getByLabelText("Ordenar por"), { target: { value: "price" } });
    await waitFor(() => expect(searchProducts).toHaveBeenLastCalledWith("iphone", 1, "price"));
    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    await waitFor(() => expect(searchProducts).toHaveBeenLastCalledWith("iphone", 2, "price"));
    view.rerender(<SearchStateProvider><p>Página do produto</p></SearchStateProvider>);
    view.rerender(<SearchStateProvider><HomePage /></SearchStateProvider>);
    expect(screen.getByLabelText("Buscar produto")).toHaveValue("iphone");
    expect(screen.getByLabelText("Ordenar por")).toHaveValue("price");
    expect(screen.getByText("Página 2 de 2")).toBeInTheDocument();
    expect(screen.getByText("iPhone")).toBeInTheDocument();
    expect(searchProducts).toHaveBeenCalledTimes(3);
  });

  it("reinicia estado ao montar uma nova sessão de Home", async () => {
    vi.mocked(searchProducts).mockResolvedValue({ page: 1, limit: 20, total: 1, items: [product] });
    const view = renderHome();
    submitSearch("iphone");
    await screen.findByText("iPhone");
    view.unmount();
    renderHome();
    expect(screen.getByLabelText("Buscar produto")).toHaveValue("");
    expect(screen.getByText(/encontre um produto/i)).toBeInTheDocument();
  });

  it("troca de página preserva busca e sort e faz scroll suave após a resposta", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    vi.mocked(searchProducts)
      .mockResolvedValueOnce({ page: 1, limit: 20, total: 21, items: [product] })
      .mockResolvedValueOnce({ page: 2, limit: 20, total: 21, items: [product] });
    renderHome();
    submitSearch("iphone");
    await screen.findByText("iPhone");
    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    await waitFor(() => expect(searchProducts).toHaveBeenLastCalledWith("iphone", 2, "history"));
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" }));
  });
});
