import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Idividream",
  description: "A freshly initialized Next.js app."
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-950 text-slate-50 antialiased">
        {children}
      </body>
    </html>
  );
}
