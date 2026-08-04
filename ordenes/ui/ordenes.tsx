'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AREA_LABELS, AREA_COLORS,
  type Orden, type OrderStatus,
  formatDateShort,
} from '@/compartido/mock-data';
import { progresoOrden, areaEnCurso, type AvanceArea } from '@/produccion/produccion';
import { useSession, canUpload } from '@/autenticacion/auth';

// Órdenes por página. El histórico no se carga completo: el servidor manda solo
// la página visible (ver ordenes/api/ordenes-listado.ts).
const POR_PAGINA = 15;

const STATUS_MAP = {
  activa:     { bg: 'bg-brand-green-light',  text: 'text-[#1A1A1A]',       label: 'Activa' },
  programada: { bg: 'bg-brand-orange-light', text: 'text-[#1A1A1A]', label: 'Programada' },
  pausada:    { bg: 'bg-[#ECEAF2]',          text: 'text-[#1A1A1A]',         label: 'Pausada' },
  terminada:  { bg: 'bg-[#E0E7E1]',          text: 'text-[#1A1A1A]',  label: 'Terminada' },
  cancelada:  { bg: 'bg-red-50',             text: 'text-[#1A1A1A]',           label: 'Cancelada' },
} as const;

const TABS: { key: 'todas' | OrderStatus; label: string }[] = [
  { key: 'todas',      label: 'Todas' },
  { key: 'activa',     label: 'Activas' },
  { key: 'programada', label: 'Programadas' },
  { key: 'pausada',    label: 'Pausadas' },
  { key: 'terminada',  label: 'Terminadas' },
];

const CONTEOS_VACIOS: Record<string, number> = {
  todas: 0, activa: 0, programada: 0, pausada: 0, terminada: 0, cancelada: 0,
};

export default function OrdenesPage() {
  const [tab, setTab]       = useState<'todas' | OrderStatus>('todas');
  const [search, setSearch] = useState('');
  const [pagina, setPagina] = useState(1);
  const { sesion } = useSession();
  const puedeSubir = canUpload(sesion?.rol);

  // Solo vive en memoria la página que se está viendo.
  const [ordenes, setOrdenes] = useState<Orden[]>([]);
  const [avances, setAvances] = useState<Record<string, AvanceArea[]>>({});
  const [conteos, setConteos] = useState(CONTEOS_VACIOS);
  const [paginas, setPaginas] = useState(1);
  const [total, setTotal]     = useState(0);
  const [cargando, setCargando] = useState(true);

  // La búsqueda espera a que dejes de teclear antes de consultar al servidor.
  const [busqueda, setBusqueda] = useState('');
  useEffect(() => {
    const t = setTimeout(() => { setBusqueda(search.trim()); setPagina(1); }, 350);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => { setPagina(1); }, [tab]);

  const cargar = useCallback(async () => {
    if (!sesion?.email) return;
    setCargando(true);
    try {
      const p = new URLSearchParams({ pagina: String(pagina), limite: String(POR_PAGINA) });
      if (tab !== 'todas') p.set('estado', tab);
      if (busqueda) p.set('q', busqueda);
      const res = await fetch(`/api/ordenes?${p.toString()}`, {
        headers: { 'x-user-email': sesion.email },
        cache: 'no-store',
      });
      if (!res.ok) return;
      const d = await res.json();
      setOrdenes(d.ordenes as Orden[]);
      setAvances(d.avances as Record<string, AvanceArea[]>);
      setConteos({ ...CONTEOS_VACIOS, ...d.conteos });
      setPaginas(d.paginas);
      setTotal(d.total);
      // El servidor acota la página si te pasaste del final (p. ej. al filtrar).
      if (d.pagina !== pagina) setPagina(d.pagina);
    } catch {
      /* sin red: se conserva en pantalla lo que ya se había cargado */
    } finally {
      setCargando(false);
    }
  }, [sesion?.email, pagina, tab, busqueda]);

  useEffect(() => { cargar(); }, [cargar]);

  // Al volver a la pestaña se recarga: otro usuario pudo crear o cerrar órdenes.
  useEffect(() => {
    const alVolver = () => { if (document.visibilityState === 'visible') cargar(); };
    window.addEventListener('focus', alVolver);
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      window.removeEventListener('focus', alVolver);
      document.removeEventListener('visibilitychange', alVolver);
    };
  }, [cargar]);

  const estadoDe = (id: string): OrderStatus =>
    ordenes.find(o => o.id === id)?.status ?? 'activa';
  const counts = conteos;
  const filtered = ordenes;
  const desde = total === 0 ? 0 : (pagina - 1) * POR_PAGINA + 1;
  const hasta = Math.min(pagina * POR_PAGINA, total);

  return (
    <div className="p-4 lg:p-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-xl lg:text-2xl font-semibold text-[#1A1A1A] mb-1">
            Órdenes de producción
          </h1>
          <p className="text-sm text-[#6B716C]">
            {total === 0
              ? 'Sin órdenes'
              : <>Mostrando {desde}–{hasta} de {total} {total === 1 ? 'orden' : 'órdenes'}</>}
            {cargando && <span className="text-[#8A9A8C]"> · actualizando…</span>}
          </p>
        </div>
        {puedeSubir && (
          <Link
            href="/ordenes/nueva"
            className="flex items-center gap-2 bg-brand-green text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-brand-green-dark active:scale-[0.98] transition-all shadow-sm flex-shrink-0"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            <span className="hidden sm:inline">Nueva orden</span>
            <span className="sm:hidden">Nueva</span>
          </Link>
        )}
      </div>

      {/* Tabs + búsqueda */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="flex items-center gap-1 bg-[#EEF3EE] rounded-xl p-1 overflow-x-auto flex-shrink-0">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                tab === t.key
                  ? 'bg-white text-[#1A1A1A] shadow-sm'
                  : 'text-[#6B716C] hover:text-[#1A1A1A]'
              }`}
            >
              {t.label}
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                tab === t.key ? 'bg-brand-green text-white' : 'bg-[#E2E5E2] text-[#6B716C]'
              }`}>
                {counts[t.key]}
              </span>
            </button>
          ))}
        </div>

        <div className="relative flex-1">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8A9A8C]">
            <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10.5 10.5L13 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            placeholder="Buscar por orden, cliente, spec o tipo…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-[#E2E5E2] rounded-xl bg-white focus:outline-none focus:ring-1 focus:ring-brand-green focus:border-brand-green placeholder:text-[#8A9A8C]"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptySearch onClear={() => { setTab('todas'); setSearch(''); }} />
      ) : (
        <>
          {/* Desktop — tabla */}
          <div className="hidden lg:block bg-white border border-[#E2E5E2] rounded-xl shadow-card overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#E2E5E2] bg-brand-green-50/50">
                  <th className="text-left text-[11px] uppercase tracking-wide text-[#6B716C] font-medium px-4 py-3">No. Orden</th>
                  <th className="text-left text-[11px] uppercase tracking-wide text-[#6B716C] font-medium px-4 py-3">Cliente</th>
                  <th className="text-left text-[11px] uppercase tracking-wide text-[#6B716C] font-medium px-4 py-3">Spec / Medida</th>
                  <th className="text-left text-[11px] uppercase tracking-wide text-[#6B716C] font-medium px-4 py-3">Tipo</th>
                  <th className="text-right text-[11px] uppercase tracking-wide text-[#6B716C] font-medium px-4 py-3">Piezas</th>
                  <th className="text-left text-[11px] uppercase tracking-wide text-[#6B716C] font-medium px-4 py-3 w-44">Avance</th>
                  <th className="text-left text-[11px] uppercase tracking-wide text-[#6B716C] font-medium px-4 py-3">Status</th>
                  <th className="text-left text-[11px] uppercase tracking-wide text-[#6B716C] font-medium px-4 py-3">FMF</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0F5F0]">
                {filtered.map(orden => {
                  const est = estadoDe(orden.id);
                  const s = STATUS_MAP[est];
                  const enCurso = areaEnCurso(avances[orden.id] ?? []);
                  const area = enCurso ? AREA_COLORS[enCurso] : null;
                  const progress = progresoOrden(avances[orden.id] ?? []);
                  const isVencida = orden.fecha_entrega
                    && new Date(orden.fecha_entrega) < new Date()
                    && est === 'activa';

                  return (
                    <tr key={orden.id} className="hover:bg-brand-green-50/20 transition-colors cursor-pointer group"
                      onClick={() => window.location.href = `/ordenes/${orden.id}`}>
                      <td className="px-4 py-3">
                        <div className="text-sm font-bold text-[#1A1A1A] font-mono">{orden.numero_orden}</div>
                        {orden.orden_cliente && (
                          <div className="text-[10px] text-[#8A9A8C]">OC: {orden.orden_cliente}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm text-[#1A1A1A] font-medium">{orden.cliente}</div>
                        {orden.embarcar_a && (
                          // En la tabla los destinos van en una línea para no
                          // desbalancear los renglones; completos en el detalle.
                          <div className="text-[10px] text-[#8A9A8C]">
                            {orden.embarcar_a.split('\n').filter(Boolean).join(' · ')}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm text-[#1A1A1A] font-medium">{orden.spec}</div>
                        <div className="text-[10px] text-[#6B716C] font-mono">{orden.medida}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-xs font-medium text-[#1A1A1A]">{orden.tipo_saco}</div>
                        {orden.grado && (
                          <div className="text-[10px] text-[#1A1A1A] font-medium">{orden.grado}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="text-sm font-mono font-bold text-[#1A1A1A]">
                          {orden.cantidad.toLocaleString()}
                        </div>
                        <div className="text-[10px] text-[#8A9A8C]">{orden.carga_lbs.toLocaleString()} Lbs</div>
                      </td>
                      <td className="px-4 py-3 w-44">
                        <div className="flex items-center justify-between mb-1">
                          <span className={`text-[10px] font-medium ${enCurso ? area!.text : 'text-[#1A1A1A]'}`}>
                            {enCurso ? AREA_LABELS[enCurso] : progress >= 100 ? 'Completado' : 'Por iniciar'}
                          </span>
                          <span className="text-[10px] text-[#8A9A8C]">{progress}%</span>
                        </div>
                        <div className="h-1.5 bg-[#E8EFE9] rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full bg-brand-green transition-all"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-md text-xs font-medium ${s.bg} ${s.text}`}>
                          {s.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium ${isVencida ? 'text-[#1A1A1A]' : 'text-[#6B716C]'}`}>
                          {formatDateShort(orden.fecha_entrega)}
                        </span>
                        {isVencida && (
                          <div className="text-[10px] text-[#1A1A1A] font-semibold">¡Vencida!</div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Móvil — tarjetas */}
          <div className="lg:hidden space-y-3">
            {filtered.map(orden => {
              const est = estadoDe(orden.id);
              const s = STATUS_MAP[est];
              const enCurso = areaEnCurso(avances[orden.id] ?? []);
              const area = enCurso ? AREA_COLORS[enCurso] : null;
              const progress = progresoOrden(avances[orden.id] ?? []);
              const isVencida = orden.fecha_entrega
                && new Date(orden.fecha_entrega) < new Date()
                && est === 'activa';

              return (
                <Link key={orden.id} href={`/ordenes/${orden.id}`} className="block bg-white border border-[#E2E5E2] rounded-xl p-4 shadow-card hover:shadow-card-hover hover:border-brand-green/30 transition-all">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="text-sm font-bold text-[#1A1A1A] font-mono">{orden.numero_orden}</div>
                      <div className="text-xs text-[#6B716C] font-medium">{orden.cliente}</div>
                    </div>
                    <span className={`inline-flex px-2 py-0.5 rounded-md text-xs font-medium flex-shrink-0 ${s.bg} ${s.text}`}>
                      {s.label}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-2 mb-3">
                    <span className="text-[11px] bg-brand-green-light text-[#1A1A1A] px-2 py-0.5 rounded font-medium">
                      {orden.spec}
                    </span>
                    <span className="text-[11px] text-[#6B716C] font-mono">{orden.medida}</span>
                    <span className="text-[11px] text-[#6B716C]">{orden.tipo_saco}</span>
                    <span className="text-[11px] font-mono font-bold text-[#1A1A1A]">
                      {orden.cantidad.toLocaleString()} pzas
                    </span>
                  </div>

                  <div className="mb-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-[11px] font-medium ${enCurso ? area!.text : 'text-[#1A1A1A]'}`}>
                        {enCurso ? AREA_LABELS[enCurso] : progress >= 100 ? 'Completado' : 'Por iniciar'}
                      </span>
                      <span className="text-[11px] text-[#8A9A8C]">{progress}%</span>
                    </div>
                    <div className="h-1.5 bg-[#E8EFE9] rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-brand-green" style={{ width: `${progress}%` }} />
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-3 border-t border-[#F0F5F0] text-[11px]">
                    <span className="text-[#8A9A8C]">
                      {orden.embarcar_a ? orden.embarcar_a.split('\n').filter(Boolean).join(' · ') : '—'}
                    </span>
                    <span className={`font-medium ${isVencida ? 'text-[#1A1A1A]' : 'text-[#6B716C]'}`}>
                      FMF: {formatDateShort(orden.fecha_entrega)}
                      {isVencida && ' ⚠'}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>

          {paginas > 1 && (
            <Paginacion
              pagina={pagina}
              paginas={paginas}
              cargando={cargando}
              onIr={(p) => { setPagina(p); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
            />
          )}
        </>
      )}
    </div>
  );
}

// ─── Paginación ───────────────────────────────────────────────────────────────

function Paginacion({
  pagina, paginas, cargando, onIr,
}: {
  pagina: number;
  paginas: number;
  cargando: boolean;
  onIr: (p: number) => void;
}) {
  // Ventana de páginas alrededor de la actual: con muchas páginas no tiene
  // sentido pintarlas todas.
  const desde = Math.max(1, Math.min(pagina - 2, paginas - 4));
  const hasta = Math.min(paginas, desde + 4);
  const numeros: number[] = [];
  for (let p = desde; p <= hasta; p++) numeros.push(p);

  const btn =
    'min-w-[34px] h-[34px] px-2 text-xs font-medium rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

  return (
    <nav aria-label="Paginación" className="flex items-center justify-center gap-1.5 mt-5 flex-wrap">
      <button
        onClick={() => onIr(pagina - 1)}
        disabled={pagina <= 1 || cargando}
        className={`${btn} border-[#E2E5E2] bg-white text-[#1A1A1A] hover:bg-[#F6F8F1]`}
      >
        ← Anterior
      </button>

      {desde > 1 && <span className="text-xs text-[#8A9A8C] px-1">…</span>}

      {numeros.map(p => (
        <button
          key={p}
          onClick={() => onIr(p)}
          disabled={cargando}
          aria-current={p === pagina ? 'page' : undefined}
          className={`${btn} ${
            p === pagina
              ? 'bg-brand-green border-brand-green text-white font-semibold'
              : 'border-[#E2E5E2] bg-white text-[#1A1A1A] hover:bg-[#F6F8F1]'
          }`}
        >
          {p}
        </button>
      ))}

      {hasta < paginas && <span className="text-xs text-[#8A9A8C] px-1">…</span>}

      <button
        onClick={() => onIr(pagina + 1)}
        disabled={pagina >= paginas || cargando}
        className={`${btn} border-[#E2E5E2] bg-white text-[#1A1A1A] hover:bg-[#F6F8F1]`}
      >
        Siguiente →
      </button>
    </nav>
  );
}

function EmptySearch({ onClear }: { onClear: () => void }) {
  return (
    <div className="bg-white border border-[#E2E5E2] rounded-2xl p-10 text-center shadow-card">
      <div className="w-12 h-12 rounded-full bg-[#EEF3EE] flex items-center justify-center mx-auto mb-3">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <circle cx="10" cy="10" r="7" stroke="#6B716C" strokeWidth="1.5" />
          <path d="M15.5 15.5L20 20" stroke="#6B716C" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>
      <h3 className="text-sm font-semibold text-[#1A1A1A] mb-1">Sin resultados</h3>
      <p className="text-xs text-[#6B716C] mb-3">No se encontraron órdenes con ese filtro.</p>
      <button onClick={onClear} className="text-xs font-medium text-[#1A1A1A] hover:text-[#1A1A1A]">
        Limpiar filtros
      </button>
    </div>
  );
}
