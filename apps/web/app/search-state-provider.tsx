"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { ProductSearchResponse, ProductSearchSort } from "@/lib/types/api";

interface SearchState {
  query: string;
  activeQuery: string;
  page: number;
  sort: ProductSearchSort;
  result: ProductSearchResponse | null;
}

interface SearchStateContextValue {
  state: SearchState;
  update: (next: Partial<SearchState>) => void;
}

const initialState: SearchState = { query: "", activeQuery: "", page: 1, sort: "history", result: null };
const SearchStateContext = createContext<SearchStateContextValue | null>(null);

export function SearchStateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SearchState>(initialState);
  const update = useCallback((next: Partial<SearchState>) => setState((current) => ({ ...current, ...next })), []);
  const value = useMemo(() => ({ state, update }), [state, update]);
  return <SearchStateContext.Provider value={value}>{children}</SearchStateContext.Provider>;
}

export function useSearchState(): SearchStateContextValue {
  const context = useContext(SearchStateContext);
  if (!context) throw new Error("useSearchState deve ser usado dentro de SearchStateProvider.");
  return context;
}
