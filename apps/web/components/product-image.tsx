"use client";

import { useState } from "react";

export function ProductImage({ src, alt, className = "" }: { src: string | null; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <div className={`grid place-items-center bg-slate-100 text-slate-400 ${className}`} role="img" aria-label={`Imagem indisponível: ${alt}`}><span aria-hidden="true" className="text-2xl">⌁</span><span className="sr-only">Imagem indisponível</span></div>;
  return <img src={src} alt={alt} onError={() => setFailed(true)} className={className} />;
}
