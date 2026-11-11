import Link from "next/link";
import { ProductImage } from "@/components/product-image";
import type { ProductSummary } from "@/lib/types/api";
import { formatMoney } from "@/lib/formatting";

export function ProductCard({ product }: { product: ProductSummary }) {
  const context = [product.brand, product.model].filter(Boolean).join(" · ") || "Produto monitorado";
  return <Link href={`/products/${product.id}`} className="group surface flex min-w-0 overflow-hidden transition duration-200 hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-float focus:outline-none sm:flex-col">
    <div className="w-28 shrink-0 bg-slate-50/70 sm:w-full"><ProductImage src={product.imageUrl} alt={product.name} className="aspect-square w-full object-contain p-3 transition duration-300 group-hover:scale-[1.025] sm:p-5" /></div>
    <div className="flex min-w-0 flex-1 flex-col p-4 sm:p-5"><p className="line-clamp-2 text-[0.95rem] font-bold leading-5 text-ink sm:text-base sm:leading-6">{product.name}</p><p className="mt-1.5 line-clamp-1 text-sm text-slate-500">{context}</p>
      <div className="mt-4 flex items-end justify-between gap-3 border-t border-slate-100 pt-3 sm:mt-5"><div className="min-w-0"><p className="text-[0.68rem] font-bold uppercase tracking-[0.11em] text-slate-500">Preço atual</p><p className="mt-1 truncate text-xl font-extrabold tracking-[-0.025em] text-brand-950 sm:text-2xl">{formatMoney(product.currentPrice, product.currency ?? "BRL")}</p></div><span className={`shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-bold ${product.matchStatus === "review_required" ? "bg-amber-50 text-amber-900" : "bg-brand-50 text-brand-950"}`}>{product.matchStatus === "review_required" ? "Em revisão" : "Detalhes"}</span></div>
      {product.matchStatus === "review_required" && <p className="mt-3 text-xs leading-5 text-amber-800">Ofertas ainda podem estar em processo de validação.</p>}</div>
  </Link>;
}
