import type { Metadata } from "next";
import { DM_Sans, Public_Sans, Inter } from "next/font/google";
import "./globals.css";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "BrandingLab",
  description: "Plataforma SaaS para gestão de marca",
  openGraph: {
    title: "BrandingLab",
    description: "Plataforma SaaS para gestão de marca",
    images: [
      {
        url: "/bl-logo.svg",
        width: 1200,
        height: 630,
        alt: "BrandingLab",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "BrandingLab",
    description: "Plataforma SaaS para gestão de marca",
    images: ["/bl-logo.svg"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body
        className={`${dmSans.variable} ${publicSans.variable} ${inter.variable} antialiased bg-slate-50`}
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
