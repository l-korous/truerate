import type { Metadata } from "next";
import { Fraunces, Hanken_Grotesk } from "next/font/google";
import { getLocale } from "next-intl/server";
import "./globals.css";

const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
});
const body = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "TrueRate — the rate that's actually yours",
  description:
    "Your loyalty memberships unlock rates the anonymous web never shows you. TrueRate puts them all in one place.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let locale = "en";
  try {
    locale = await getLocale();
  } catch {
    // Fallback if locale context is not available (e.g., static generation)
  }

  return (
    <html lang={locale} className={`${display.variable} ${body.variable}`}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
