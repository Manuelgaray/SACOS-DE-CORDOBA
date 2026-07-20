'use client';

import Link from 'next/link';
import { AREAS_FLOW, AREA_LABELS, AREA_COLORS, type OrderStatus } from '@/compartido/mock-data';
import { useProduccion } from '@/produccion/produccion-store';
import { progresoArea } from '@/produccion/produccion';

export default function ProduccionHubPage() {
  const { ordenes, avances, estados, ready } = useProduccion();

  if (!ready) return <Cargando />;

  const estadoDe = (id: string): OrderStatus => estados[id] ?? ordenes.find(o => o.id === id)!.status;
  const enProduccion = ordenes.filter(o => ['activa', 'pausada'].includes(estadoDe(o.id)));

  const resumen = AREAS_FLOW.map((area) => {
    const ordenesArea = enProduccion.filter(o => {
      const av = avances[o.id]?.find(a => a.area === area);
      return av && progresoArea(av) < 100;
    });
    const piezasPend = ordenesArea.reduce((s, o) => {
      const av = avances[o.id]?.find(a => a.area === area);
      if (!av) return s;
      return s + av.componentes.reduce((ss, c) => ss + Math.max(0, c.meta - c.hecho), 0);
    }, 0);
    return { area, ordenesArea, piezasPend };
  });

  return (
    <div className="p-4 lg:p-6 max-w-7xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl lg:text-2xl font-semibold text-[#1A1A1A] mb-0.5">Producción por área</h1>
        <p className="text-sm text-[#6B716C]">
          Selecciona tu área para capturar el avance del turno
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {resumen.map(({ area, ordenesArea, piezasPend }) => {
          const c = AREA_COLORS[area];
          return (
            <Link
              key={area}
              href={`/produccion/${area}`}
              className="group bg-white border border-[#E2E5E2] rounded-xl shadow-card hover:shadow-card-hover hover:border-brand-green/40 transition-all overflow-hidden"
            >
              <div className={`px-4 py-3 ${c.bg} border-b ${c.border}`}>
                <div className="flex items-center justify-between">
                  <span className={`text-sm font-bold ${c.text}`}>{AREA_LABELS[area]}</span>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="opacity-40 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all">
                    <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={c.text} />
                  </svg>
                </div>
              </div>
              <div className="p-4">
                <div className="flex items-end justify-between">
                  <div>
                    <div className="text-3xl font-bold text-[#1A1A1A] leading-none">{ordenesArea.length}</div>
                    <div className="text-[11px] text-[#8A9A8C] mt-1">
                      {ordenesArea.length === 1 ? 'orden en cola' : 'órdenes en cola'}
                    </div>
                  </div>
                  {piezasPend > 0 && (
                    <div className="text-right">
                      <div className="text-sm font-semibold text-[#1A1A1A] font-mono">
                        {piezasPend.toLocaleString()}
                      </div>
                      <div className="text-[10px] text-[#8A9A8C]">pzas pendientes</div>
                    </div>
                  )}
                </div>
                {ordenesArea.length === 0 && (
                  <div className="mt-2 text-[11px] text-[#1A1A1A] font-medium">✓ Al día</div>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function Cargando() {
  return (
    <div className="p-6 flex items-center justify-center min-h-[40vh]">
      <div className="flex items-center gap-2 text-sm text-[#6B716C]">
        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Cargando producción...
      </div>
    </div>
  );
}
