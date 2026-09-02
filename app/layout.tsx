import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Central do Almoxarifado",
  description:
    "Plataforma interna para segurança, conhecimento técnico e operações do almoxarifado.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var saved=localStorage.getItem('almox-theme');var theme=(saved==='light'||saved==='dark')?saved:(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.dataset.theme=theme}catch(e){}})();`,
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
        <a
          href="/privacidade"
          aria-label="Abrir Privacidade e LGPD"
          style={{
            position: "fixed",
            right: 18,
            bottom: 18,
            zIndex: 120,
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 14px",
            borderRadius: 999,
            border: "1px solid rgba(5,116,185,.18)",
            background: "rgba(255,255,255,.94)",
            color: "#225b8f",
            boxShadow: "0 10px 30px rgba(6,56,79,.14)",
            fontSize: 11,
            fontWeight: 800,
            textDecoration: "none",
            backdropFilter: "blur(10px)",
          }}
        >
          Privacidade e LGPD
        </a>
      </body>
    </html>
  );
}
