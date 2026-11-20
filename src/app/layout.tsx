import { ThemeProvider } from "@rtorcato/react-common";
import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import type { CSSProperties } from "react";
import { Toaster } from "sonner";
import "./globals.css";

// DESIGN.md → Type: Inter for UI text, JetBrains Mono for code-like values.
const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Hive",
  description: "Read-only dashboard for the Buzz hive",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} dark h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        {/* DESIGN.md → Obsidian redesign: dark only, whatever was stored. */}
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          forcedTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
        >
          {children}
          {/* At the root so toasts sit above dialogs. Top, clear of the
              phones' bottom sheet. Sonner reads the app's tokens. */}
          <Toaster
            position="top-center"
            style={
              {
                "--normal-bg": "var(--popover)",
                "--normal-text": "var(--popover-foreground)",
                "--normal-border": "var(--border)",
              } as CSSProperties
            }
          />
        </ThemeProvider>
      </body>
    </html>
  );
}
