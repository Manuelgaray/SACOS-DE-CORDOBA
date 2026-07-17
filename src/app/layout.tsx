import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SACOS DE CORDOBA",
  description: "Sistema de gestión de órdenes de producción — Sacos de Córdoba",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
