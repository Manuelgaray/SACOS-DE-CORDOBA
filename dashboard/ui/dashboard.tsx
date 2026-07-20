'use client';

import Link from 'next/link';
import { AREA_LABELS, AREA_COLORS, formatDateShort, type OrderStatus } from '@/compartido/mock-data';
import { useProduccion } from '@/produccion/produccion-store';
import { progresoOrden, areaEnCurso } from '@/produccion/produccion';
import { useSession } from '@/autenticacion/auth';

const ESTADO_OPCIONES: { v: OrderStatus; label: string }[] = [
  { v: 'activa',     label: 'Activa' },
  { v: 'programada', label: 'Programada' },
  { v: 'pausada',    label: 'Pausada' },
  { v: 'terminada',  label: 'Terminada' },
  { v: 'cancelada',  label: 'Cancelada' },
];

export default function DashboardPage() {
  const { ordenes, avances, estados, ready, setEstado } = useProduccion();
  const { sesion } = useSession();
  const esAdmin = sesion?.rol === 'admin'; // solo el admin cambia estados

  if (!ready) return <Cargando />;

  const estadoDe = (id: string): OrderStatus => estados[id] ?? ordenes.find(o => o.id === id)!.status;
  const progDe   = (id: string) => progresoOrden(avances[id] ?? []);

  const hoy = new Date();

  const ordenesLinea = (linea: 1 | 2) =>
    ordenes
      .filter(o => o.linea === linea && ['activa', 'pausada'].includes(estadoDe(o.id)))
      .sort((a, b) => progDe(b.id) - progDe(a.id));

  const colaLinea = (linea: 1 | 2) =>
    ordenes.filter(o => o.linea === linea && estadoDe(o.id) === 'programada');

  return (
    <div className="p-4 lg:p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl lg:text-2xl font-semibold text-[#1A1A1A] mb-0.5">Dashboard</h1>
        <p className="text-sm text-[#6B716C]">Resumen de producción — mayo 2026</p>
      </div>

      {/* Líneas de producción */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {([1, 2] as const).map(linea => (
          <div key={linea} className="bg-white border border-[#E2E5E2] rounded-xl shadow-card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#E8EFE9] bg-sidebar-bg">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <span className="w-6 h-6 rounded-md bg-brand-orange flex items-center justify-center text-xs">{linea}</span>
                Línea de producción {linea}
              </h2>
              <span className="text-[11px] text-white/60">{ordenesLinea(linea).length} en proceso</span>
            </div>

            <div className="divide-y divide-[#F0F5F0]">
              {ordenesLinea(linea).length === 0 && (
                <div className="px-4 py-6 text-center text-sm text-[#8A9A8C]">Sin órdenes en proceso</div>
              )}
              {ordenesLinea(linea).map(orden => {
                const prog = progDe(orden.id);
                const enCurso = areaEnCurso(avances[orden.id] ?? []);
                const est = estadoDe(orden.id);
                const isVencida = orden.fecha_entrega && new Date(orden.fecha_entrega) < hoy && est === 'activa';
                const areaC = enCurso ? AREA_COLORS[enCurso] : null;
                return (
                  <div key={orden.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        <Link href={`/ordenes/${orden.id}`} className="text-sm font-bold text-[#1A1A1A] font-mono hover:text-[#1A1A1A]">
                          {orden.numero_orden}
                        </Link>
                        <div className="text-xs text-[#6B716C] truncate">
                          {orden.cliente} · {orden.tipo_saco} · <span className="font-mono">{orden.cantidad.toLocaleString()}</span>
                        </div>
                      </div>
                      <EstadoSelect value={est} onChange={(v) => setEstado(orden.id, v)} soloLectura={!esAdmin} />
                    </div>

                    {/* Barra global */}
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-[#E8EFE9] rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${est === 'pausada' ? 'bg-[#8077A0]' : 'bg-brand-green'}`}
                          style={{ width: `${prog}%` }}
                        />
                      </div>
                      <span className="text-xs font-bold text-[#1A1A1A] w-9 text-right">{prog}%</span>
                    </div>

                    <div className="flex items-center justify-between mt-1.5">
                      {enCurso ? (
                        <Link href={`/produccion/${enCurso}`} className={`text-[11px] font-medium px-1.5 py-0.5 rounded ${areaC!.bg} ${areaC!.text} hover:opacity-80`}>
                          En {AREA_LABELS[enCurso]}
                        </Link>
                      ) : (
                        <span className="text-[11px] text-[#1A1A1A] font-medium">Completada</span>
                      )}
                      <span className={`text-[11px] ${isVencida ? 'text-[#1A1A1A] font-medium' : 'text-[#8A9A8C]'}`}>
                        FMF: {formatDateShort(orden.fecha_entrega)}{isVencida ? ' ⚠' : ''}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Cola programada */}
            {colaLinea(linea).length > 0 && (
              <div className="px-4 py-2.5 border-t border-[#E8EFE9] bg-[#F8FAF8]">
                <div className="text-[10px] uppercase tracking-wide text-[#8A9A8C] font-medium mb-1.5">En cola</div>
                <div className="flex flex-wrap gap-1.5">
                  {colaLinea(linea).map(o => (
                    <Link key={o.id} href={`/ordenes/${o.id}`}
                      className="text-[11px] font-mono bg-brand-orange-light text-[#1A1A1A] px-2 py-0.5 rounded hover:opacity-80">
                      {o.numero_orden}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      
    </div>
  );
}

function EstadoSelect({ value, onChange, soloLectura = false }: {
  value: OrderStatus; onChange: (v: OrderStatus) => void; soloLectura?: boolean;
}) {
  const styles: Record<OrderStatus, string> = {
    activa:     'bg-brand-green-light text-[#1A1A1A] border-brand-green/30',
    programada: 'bg-brand-orange-light text-[#1A1A1A] border-brand-orange/30',
    pausada:    'bg-[#ECEAF2] text-[#1A1A1A] border-[#6F6391]/30',
    terminada:  'bg-[#E0E7E1] text-[#1A1A1A] border-[#B8C9BA]',
    cancelada:  'bg-red-50 text-[#1A1A1A] border-red-200',
  };

  // Solo el admin puede cambiar el estado; los demás lo ven como etiqueta fija.
  if (soloLectura) {
    const label = ESTADO_OPCIONES.find(o => o.v === value)?.label ?? value;
    return (
      <span className={`text-[11px] font-semibold rounded-md border px-1.5 py-1 ${styles[value]}`}>
        {label}
      </span>
    );
  }

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as OrderStatus)}
      onClick={(e) => e.stopPropagation()}
      className={`text-[11px] font-semibold rounded-md border px-1.5 py-1 cursor-pointer focus:outline-none focus:ring-1 focus:ring-brand-green ${styles[value]}`}
    >
      {ESTADO_OPCIONES.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
    </select>
  );
}

function Cargando() {
  return (
    <div className="p-6 flex items-center justify-center min-h-[40vh] text-sm text-[#6B716C]">
      <svg className="animate-spin h-4 w-4 mr-2" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      Cargando dashboard...
    </div>
  );
}

