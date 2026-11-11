"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { AppHeader } from "@/components/app-header";
import { ProductCard } from "@/components/product-card";
import { useSearchState } from "@/app/search-state-provider";
import { searchProducts } from "@/lib/api/products";
import type { ProductSearchSort } from "@/lib/types/api";

function SearchSkeleton() {
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-label="Carregando resultados">{[1, 2, 3, 4].map((key) => <div className="surface flex overflow-hidden p-4 sm:block" key={key}><div className="skeleton aspect-square w-24 shrink-0 sm:w-full" /><div className="min-w-0 flex-1 pl-4 sm:pl-0"><div className="skeleton mt-1 h-5 w-4/5 sm:mt-5" /><div className="skeleton mt-3 h-4 w-1/2" /><div className="skeleton mt-5 h-7 w-2/5" /></div></div>)}</div>;
}

export function HomePage() {
  const { state, update } = useSearchState();
  const { query, activeQuery, page, result, sort } = state;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);
  const resultsRef = useRef<HTMLElement>(null);
  const restoredSearch = useRef(Boolean(state.activeQuery && state.result));
  const paginationScrollPending = useRef(false);

  useEffect(() => {
    if (window.location.pathname === "/" && window.location.search) window.history.replaceState(null, "", "/");
  }, []);

  useEffect(() => {
    let active = true;
    if (!activeQuery) { update({ result: null }); setError(null); setLoading(false); return; }
    if (restoredSearch.current) { restoredSearch.current = false; return; }
    setLoading(true); setError(null);
    searchProducts(activeQuery, page, sort).then((data) => {
      if (!active) return;
      update({ result: data });
      if (paginationScrollPending.current) {
        paginationScrollPending.current = false;
        const scrollToResults = () => {
          const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
          resultsRef.current?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
        };
        if (window.requestAnimationFrame) window.requestAnimationFrame(scrollToResults); else scrollToResults();
      }
    })
      .catch(() => { if (active) setError("Não foi possível carregar os dados agora."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [activeQuery, page, requestVersion, sort, update]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleaned = query.trim();
    if (!cleaned) return;
    update({ query: cleaned, activeQuery: cleaned, page: 1, result: null });
    setRequestVersion((version) => version + 1);
  }
  function retry() { setRequestVersion((version) => version + 1); }
  function changeSort(nextSort: ProductSearchSort) {
    update({ sort: nextSort, page: 1, result: null });
  }
  function changePage(nextPage: number) {
    paginationScrollPending.current = true;
    update({ page: nextPage, result: null });
  }
  const totalPages = result ? Math.max(1, Math.ceil(result.total / result.limit)) : 1;

  return <><AppHeader /><main className="min-h-screen pb-16">
    <section className="border-b border-blue-100 bg-[radial-gradient(circle_at_top,_#eff6ff,_#f7f9fc_62%)] py-12 sm:py-16">
      <div className="page-shell mx-auto max-w-4xl text-center">
      <p className="eyebrow mb-4">Compare antes de decidir</p>
      <h1 className="text-balance text-4xl font-extrabold tracking-[-0.05em] text-brand-950 sm:text-5xl lg:text-6xl">Descubra se agora é um bom momento para comprar.</h1>
      <p className="mx-auto mt-5 max-w-2xl text-pretty text-base leading-7 text-slate-600 sm:text-lg">Consulte preços atuais e histórico do catálogo que o Price Tracker já acompanha.</p>
      <form className="surface-raised mx-auto mt-8 flex max-w-2xl flex-col gap-2 p-2 sm:flex-row" onSubmit={submit}>
        <label className="sr-only" htmlFor="product-search">Buscar produto</label>
        <input id="product-search" value={query} onChange={(event) => update({ query: event.target.value })} placeholder="Busque por iPhone 15, Galaxy S24..." className="min-h-12 min-w-0 flex-1 rounded-xl bg-transparent px-4 text-base text-ink outline-none placeholder:text-slate-400" />
        <button type="submit" className="button-primary shrink-0" disabled={!query.trim() || loading}>{loading ? "Buscando…" : "Buscar"}</button>
      </form>
      <p className="mt-3 text-xs text-slate-500">A busca consulta apenas produtos persistidos; não dispara uma coleta externa.</p>
      </div>
    </section>

    <section ref={resultsRef} className="page-shell mt-10 scroll-mt-6 sm:mt-12" aria-live="polite">
      {!activeQuery && <div className="surface mx-auto max-w-2xl px-6 py-12 text-center sm:px-10"><div aria-hidden="true" className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-brand-50 text-xl text-brand-950">⌕</div><h2 className="mt-4 text-lg font-bold text-ink">Encontre um produto para começar</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600">Busque por nome, marca ou modelo para consultar preços e histórico.</p></div>}
      {loading && <SearchSkeleton />}
      {error && <div className="surface mx-auto max-w-xl border-red-200 px-6 py-10 text-center"><h2 className="text-lg font-bold text-ink">Não foi possível carregar os dados agora.</h2><p className="mt-2 text-sm text-slate-600">Tente novamente em alguns instantes.</p><button onClick={retry} className="button-secondary mt-5">Tentar novamente</button></div>}
      {!loading && !error && result && result.items.length === 0 && <div className="surface mx-auto max-w-xl px-6 py-12 text-center"><div aria-hidden="true" className="mx-auto grid h-11 w-11 place-items-center rounded-2xl bg-slate-100 text-xl text-slate-500">⌁</div><h2 className="mt-4 text-lg font-bold text-ink">Nenhum produto encontrado.</h2><p className="mt-2 text-sm leading-6 text-slate-600">Tente usar um nome mais geral ou outra variação.</p></div>}
      {!loading && !error && result && result.items.length > 0 && <><div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="eyebrow">Catálogo persistido</p><h2 className="mt-1 text-2xl font-extrabold tracking-[-0.03em] text-ink">Resultados</h2><p className="mt-1 text-sm text-slate-500">{result.total} {result.total === 1 ? "produto encontrado" : "produtos encontrados"}</p></div><label className="flex items-center gap-2 text-sm font-semibold text-slate-600" htmlFor="product-sort">Ordenar por<select id="product-sort" value={sort} onChange={(event) => changeSort(event.target.value as ProductSearchSort)} className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-ink shadow-sm outline-none transition hover:border-blue-300 focus:border-blue-500"><option value="history">Mais histórico</option><option value="price">Menor preço</option></select></label></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{result.items.map((product) => <ProductCard key={product.id} product={product} />)}</div><nav className="mt-10 flex flex-wrap items-center justify-center gap-3" aria-label="Paginação"><button onClick={() => changePage(page - 1)} disabled={page <= 1 || loading} className="button-secondary">Anterior</button><span className="rounded-lg bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700">Página {page} de {totalPages}</span><button onClick={() => changePage(page + 1)} disabled={page >= totalPages || loading} className="button-secondary">Próxima</button></nav></>}
    </section>
  </main></>;
}
