import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "./nav";

export const metadata: Metadata = {
  title: "Send a file",
  description: "Share files and chat — one-time links, same-network transfer, and a private chat.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <Nav />
        <div className="app-main">{children}</div>
      </body>
    </html>
  );
}
