import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/auth";
import { PrefsProvider } from "@/components/prefs";
import { Header } from "@/components/Header";

export const metadata: Metadata = {
  title: "Chicago Harbor Sailing",
  description:
    "Green / yellow / red sailing status for every Chicago harbor, personalized to your boat and skill — should I sail right now?",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <AuthProvider>
          <PrefsProvider>
            <Header />
            <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
            <footer className="mx-auto w-full max-w-6xl px-4 py-6 text-xs text-slate-500">
              Guidance is interpretive, from NOAA/NDBC data + a harbor-exposure model — not an official
              forecast. Always check conditions yourself before heading out.
            </footer>
          </PrefsProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
