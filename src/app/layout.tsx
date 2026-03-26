import type { Metadata, Viewport } from "next";
import "./globals.css";
import { TabBar } from "@/components/TabBar";
import { AppProviders } from "@/app/providers";
import { UnitProvider } from "@/context/UnitContext";
import { NetworkProvider } from "@/context/NetworkContext";
import { SyncStatus } from "@/components/SyncStatus";
import { InstallPrompt } from "@/components/InstallPrompt";

export const metadata: Metadata = {
  title: "Rebirth",
  description: "Personal fitness tracker",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Rebirth",
  },
  icons: {
    icon: "/icon.svg",
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#5BCEFA",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="bg-background">
        <NetworkProvider>
          <AppProviders>
            <UnitProvider>
              {children}
              <TabBar />
              <SyncStatus />
              <InstallPrompt />
            </UnitProvider>
          </AppProviders>
        </NetworkProvider>
      </body>
    </html>
  );
}
