import type { Metadata } from "next";
import "../styles/globals.css";

export const metadata: Metadata = {
  title: "Premium Web App",
  description: "Redesigned with Glassmorphism and Modern UI",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id">
      <body>
        <main className="animate-fade-in">
          {children}
        </main>
      </body>
    </html>
  );
}
