import Link from "next/link";

export function AppHeader() {
  return <header className="border-b border-slate-200/80 bg-white/95 backdrop-blur">
    <div className="page-shell flex min-h-16 items-center justify-between gap-4 sm:min-h-[4.5rem]">
      <Link href="/" className="flex items-center gap-3 rounded-lg font-extrabold text-ink" aria-label="Price Tracker, início">
        <span aria-hidden="true" className="grid h-9 w-9 place-items-center rounded-xl bg-brand-50 text-brand-700 shadow-sm"><svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 3.5v17h17" strokeOpacity="0.55" /><path d="m5.5 7 3.6 4.4 3-2.8 4.2 5.1L20 17" /><path d="M16.5 17H20v-3.5" /></svg></span>
        <span className="tracking-[-0.025em]">Price Tracker</span>
      </Link>
      <p className="hidden text-sm font-medium text-slate-500 sm:block">Preços atuais com contexto histórico</p>
    </div>
  </header>;
}
