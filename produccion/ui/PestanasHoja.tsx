'use client';

// Pestañas tipo hoja de cálculo: una orden puede tener varias hojas (producción,
// verificación…) y se cambia entre ellas sin salir de la orden.

import Link from 'next/link';

export interface Pestana {
  href: string;
  label: string;
}

// Las dos hojas del área de Calidad (control de mesas y defectos/hallazgos).
export const PESTANA_MESAS = 'Control de mesas';
export const PESTANA_DEFECTOS = 'Defectos y hallazgos';

export function pestanasCalidad(ordenId: string): Pestana[] {
  return [
    { href: `/produccion/hoja-calidad?orden=${ordenId}`, label: PESTANA_MESAS },
    { href: `/produccion/hoja-defectos?orden=${ordenId}`, label: PESTANA_DEFECTOS },
  ];
}

export default function PestanasHoja({ pestanas, activa }: { pestanas: Pestana[]; activa: string }) {
  if (pestanas.length < 2) return null;
  return (
    <div className="flex items-end gap-1 border-b border-[#E2E5E2]">
      {pestanas.map((p) => {
        const esActiva = p.label === activa;
        return (
          <Link
            key={p.href}
            href={p.href}
            className={`px-4 py-2 text-xs font-semibold rounded-t-lg border border-b-0 -mb-px transition-colors ${
              esActiva
                ? 'bg-white border-[#E2E5E2] text-[#1A1A1A]'
                : 'bg-[#EDF2ED] border-transparent text-[#6B716C] hover:bg-[#E2EAE3] hover:text-[#1A1A1A]'
            }`}
          >
            {p.label}
          </Link>
        );
      })}
    </div>
  );
}
