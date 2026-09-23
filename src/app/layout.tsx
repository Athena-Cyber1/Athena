import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Athéna v10.9.4 · design noir & blanc · HUD sélecteur de modèle (cloud + local, cascade sans secret)",
  description:
    "Athéna — agent à boucle planifier → agir → observer → vérifier → sous-agent. Mono-modèle (aucun juge 0.5B), design monochrome (blanc & noir / noir & blanc, liens rouges, symboles sans émoji, sans pied de page), thèmes importables, réponses vérifiées par outils d'autorité, échecs honnêtes.",
  keywords: ["Athéna", "agent", "IA", "vérification", "sous-agent", "traçabilité"],
  authors: [{ name: "Projet Athéna" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
