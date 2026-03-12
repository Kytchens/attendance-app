import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import Image from "next/image";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "HyprKytchen Attendance",
  description: "Attendance processing pipeline",
  icons: {
    icon: "/logo.png",
    apple: "/logo.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        {/* ── Sticky Header ── */}
        <header className="sticky top-0 z-40 h-14 flex items-center px-4 bg-white border-b border-[#E8E8E8] transition-colors duration-300">
          <div className="w-full max-w-4xl mx-auto flex items-center gap-2.5">
            <Image
              src="/logo.png"
              alt="Kytchens"
              width={32}
              height={32}
              className="h-8 w-8 rounded-lg object-contain flex-shrink-0"
            />
            <span className="font-bold text-[15px] text-[#111111] tracking-[-0.01em]">
              Kytchens{" "}
              <span className="text-[#FF6F3A] font-semibold">Attendance</span>
            </span>
          </div>
        </header>

        {/* ── Main ── */}
        <main className="max-w-4xl mx-auto px-5 py-6 animate-page-in">
          {children}
        </main>
      </body>
    </html>
  );
}
