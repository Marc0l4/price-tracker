import { classificationLabel } from "@/lib/formatting";
import type { PriceClassification } from "@/lib/types/api";

const styles: Record<PriceClassification, string> = {
  low: "border-emerald-200 bg-emerald-50 text-emerald-800",
  normal: "border-blue-200 bg-blue-50 text-blue-800",
  high: "border-red-200 bg-red-50 text-red-800",
  insufficient_data: "border-amber-200 bg-amber-50 text-amber-900",
};

export function PriceBadge({ classification }: { classification: PriceClassification }) {
  return <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-bold ${styles[classification]}`}>{classificationLabel(classification)}</span>;
}
