import type { Metadata, Viewport } from "next";
import "./globals.css";
import { TabBar } from "@/components/TabBar";
import { UnitProvider } from "@/context/UnitContext";

export const metadata: Metadata = {
  title: "Rebirth",
  description: "Personal body & identity tracking app",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="bg-background">
        <UnitProvider>
          {children}
          <TabBar />
        </UnitProvider>
      </body>
    </html>
  );
}
