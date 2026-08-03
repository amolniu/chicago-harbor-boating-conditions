import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/auth";
import { PrefsProvider } from "@/components/prefs";
import { ThemeProvider, THEME_INIT_SCRIPT } from "@/components/theme";
import { Header } from "@/components/Header";

export const metadata: Metadata = {
  title: "Chicago Harbor Sailing",
  description:
    "Green / yellow / red sailing status for every Chicago harbor, personalized to your boat and skill — should I sail right now?",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning: the script below may add `class="dark"` before React
    // hydrates, which would otherwise be reported as a server/client mismatch.
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        {/* Applies the saved theme before first paint to avoid a flash of light. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">
        <ThemeProvider>
          <AuthProvider>
            <PrefsProvider>
              <Header />
              <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
              <footer className="mx-auto w-full max-w-6xl px-4 py-6 text-xs text-faint">
                Guidance is interpretive, from NOAA/NDBC data + a harbor-exposure model — not an official
                forecast. Always check conditions yourself before heading out.
              </footer>
            </PrefsProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
