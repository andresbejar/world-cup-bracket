import type { Metadata } from "next";
import { Instrument_Serif, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Instrument Serif: display, wordmark, h1, h2 only. Never body or UI labels.
const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
  display: "swap",
});

// JetBrains Mono: country codes, scores, countdowns, all numerals.
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
});

// General Sans (Fontshare) is loaded via <link> below. next/font does not
// support Fontshare directly. Body / UI / buttons / h3-h6 use General Sans.

export const metadata: Metadata = {
  title: "World Cup Bracket",
  description:
    "Friends-and-family pool to predict FIFA World Cup 2026 results.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${instrumentSerif.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <head>
        <link
          rel="preconnect"
          href="https://api.fontshare.com"
          crossOrigin="anonymous"
        />
        <link
          rel="stylesheet"
          href="https://api.fontshare.com/v2/css?f[]=general-sans@400,500,600,700&display=swap"
        />
      </head>
      <body className="min-h-full bg-bg text-text-primary">
        {children}
      </body>
    </html>
  );
}
