import type { Metadata } from "next";
import { SearchStateProvider } from "./search-state-provider";
import "./globals.css";

export const metadata: Metadata = { title: "Price Tracker", description: "Compare preços atuais com o histórico do produto." };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body><SearchStateProvider>{children}</SearchStateProvider></body></html>;
}
