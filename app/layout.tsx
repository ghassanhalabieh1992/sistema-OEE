import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GAP OEE | Gestão de eficiência industrial",
  description: "Importe, valide e analise a eficiência da operação."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
