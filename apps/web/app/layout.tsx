import type { Metadata } from "next";
import { Fraunces, Hanken_Grotesk } from "next/font/google";
import "./globals.css";
import { ErrorReporter } from "../components/ErrorReporter";
import { CookieBanner } from "../components/CookieBanner";
import {
  buildPageMetadata,
  organizationJsonLd,
  websiteJsonLd,
  softwareApplicationJsonLd,
} from "@/lib/seo";

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

export const metadata: Metadata = buildPageMetadata();

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body className="font-sans">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify([
              organizationJsonLd,
              websiteJsonLd,
              softwareApplicationJsonLd,
            ]),
          }}
        />
        <ErrorReporter />
        <CookieBanner />
        {children}
      </body>
    </html>
  );
}
