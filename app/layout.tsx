import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "PitchSight Live",
  description: "Real-time tactical telemetry dashboard for the bench.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
