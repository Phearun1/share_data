import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Send a file",
  description: "Upload a file and share a one-time download link.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
