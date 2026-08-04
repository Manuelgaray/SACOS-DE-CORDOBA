'use client';

// Abre la versión imprimible del formato (réplica del papel) para guardarla
// como PDF y archivarla. Se usa en el encabezado de cada hoja de captura.

import Link from 'next/link';
import type { TipoHoja } from '@/produccion/ui/imprimir-hoja';

export default function BotonImprimir({
  orden, hoja, texto = 'Descargar formato', className, permitido = true,
}: {
  orden: string;
  hoja: TipoHoja;
  texto?: string;
  className?: string;
  // El formato de un área solo lo baja quien captura en ella (o el admin):
  // mismo criterio que la captura. La pantalla de impresión lo vuelve a validar.
  permitido?: boolean;
}) {
  if (!permitido) return null;

  return (
    <Link
      href={`/produccion/imprimir?orden=${orden}&hoja=${hoja}`}
      className={
        className ??
        'no-imprimir mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-[#1A6B4A] border border-brand-green/40 hover:bg-brand-green-50 rounded-lg px-3 py-2 transition-colors'
      }
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M5 6V2.5h6V6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M4 11H2.5V6.5h11V11H12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="5" y="9.5" width="6" height="4" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
      {texto}
    </Link>
  );
}
