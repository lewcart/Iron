import type { Metadata, Viewport } from "next";
import "./globals.css";
import { TabBar } from "@/components/TabBar";
import { AppProviders } from "@/app/providers";
import { UnitProvider } from "@/context/UnitContext";
import { NetworkProvider } from "@/context/NetworkContext";
import { SyncStatus } from "@/components/SyncStatus";
import { InstallPrompt } from "@/components/InstallPrompt";
import { InspoCaptureButton } from "@/components/InspoCaptureButton";
import { WatchInboundBridge } from "@/components/WatchInboundBridge";

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
  // Pin scale at 1 so WKWebView never zooms on input focus and the user can
  // never get stuck zoomed-in (WKWebView has no pinch-out gesture once zoomed).
  // All inputs are sized ≥16px in globals.css so iOS has no reason to auto-zoom.
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#5BCEFA",
  /** Reduces resize jank when mobile keyboards open (supported browsers). */
  interactiveWidget: "resizes-content",
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
              <WatchInboundBridge />
              {children}
              <TabBar />
              <InspoCaptureButton />
              <SyncStatus />
              <InstallPrompt />
            </UnitProvider>
          </AppProviders>
        </NetworkProvider>
      </body>
    </html>
  );
}
