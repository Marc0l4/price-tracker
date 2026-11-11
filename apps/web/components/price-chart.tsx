"use client";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { HistoryResponse } from "@/lib/types/api";
import { formatDate, formatMoney } from "@/lib/formatting";

export function chartData(history: HistoryResponse) {
  const sortedPoints = [...history.points].sort((left, right) => new Date(left.periodStart).getTime() - new Date(right.periodStart).getTime());
  const rawPointsShareADay = history.granularity === "raw" && new Set(sortedPoints.map((point) => point.lastObservedAt.slice(0, 10))).size < sortedPoints.length;

  // A categorical, unique coordinate preserves observations collected at the
  // same timestamp. The original timestamp remains available to the tooltip.
  return sortedPoints.map((point, index) => ({
    ...point,
    coordinate: `${point.periodStart}-${index}`,
    value: Number(point.lastPrice),
    minValue: Number(point.minPrice),
    maxValue: Number(point.maxPrice),
    label: rawPointsShareADay
      ? new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(point.lastObservedAt))
      : formatDate(point.lastObservedAt),
  }));
}

export function PriceChart({ history }: { history: HistoryResponse }) {
  if (!history.points.length) return <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/70 px-6 text-center"><span aria-hidden="true" className="text-2xl text-slate-400">⌁</span><p className="mt-3 font-bold text-ink">Ainda não temos histórico suficiente para este produto.</p><p className="mt-1 text-sm text-slate-500">Continue acompanhando para formar uma série de preços.</p></div>;
  // Recharts needs numeric coordinates; source values remain decimal strings until this visual boundary.
  const data = chartData(history);
  return <div className="h-72 sm:h-80" role="img" aria-label="Gráfico de histórico de preço"><ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={{ top: 18, right: 8, left: 4, bottom: 0 }}><XAxis dataKey="coordinate" tickFormatter={(coordinate) => data.find((point) => point.coordinate === coordinate)?.label ?? ""} tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} minTickGap={28}/><YAxis tickFormatter={(value) => formatMoney(String(value), history.currency)} tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} width={82}/><Tooltip cursor={{ stroke: "#bfdbfe", strokeWidth: 1 }} content={({ active, payload }) => { const point = payload?.[0]?.payload as typeof data[number] | undefined; if (!active || !point) return null; return <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-float"><p className="font-bold text-ink">{point.label}</p><p className="mt-2 font-semibold text-brand-950">Preço: {formatMoney(point.lastPrice, history.currency)}</p>{history.granularity !== "raw" && <div className="mt-2 space-y-1 text-slate-600"><p>Mínimo: {formatMoney(point.minPrice, history.currency)}</p><p>Máximo: {formatMoney(point.maxPrice, history.currency)}</p><p>Média: {formatMoney(point.averagePrice, history.currency)}</p></div>}<p className="mt-2 text-xs text-slate-500">{point.observationCount} {point.observationCount === 1 ? "observação" : "observações"}</p></div>; }} />{history.granularity !== "raw" && <><Line type="monotone" dataKey="minValue" stroke="#93c5fd" strokeDasharray="4 4" strokeWidth={1.5} dot={false} activeDot={false} /><Line type="monotone" dataKey="maxValue" stroke="#93c5fd" strokeDasharray="4 4" strokeWidth={1.5} dot={false} activeDot={false} /></>}<Line type="monotone" dataKey="value" stroke="#2563eb" strokeWidth={3} dot={data.length < 28} activeDot={{ r: 5, fill: "#0f2a5f" }} /></LineChart></ResponsiveContainer></div>;
}
