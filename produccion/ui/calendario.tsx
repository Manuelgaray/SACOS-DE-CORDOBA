'use client';

// ─────────────────────────────────────────────────────────────────────────────
//  Calendario de producción.
//
//  Vista mensual de la planta: qué día (y a qué hora) inició y terminó cada
//  orden, y la actividad diaria por área. Al elegir un día se ve el detalle:
//  avance del día por orden/área (suma de deltas por componente) y la BITÁCORA
//  cronológica de reportes (hora · quién · área · cantidades) para monitorear
//  el ritmo real de la producción. Visible para todos los usuarios.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AREAS_FLOW, AREA_LABELS, AREA_COLORS, type Area } from '@/compartido/mock-data';
import { useSession } from '@/autenticacion/auth';

interface OrdenCal {
  id: string;
  numero_orden: string;
  cliente: string;
  cantidad: number;
  status: string;
  fecha_inicio: string | null;
  fecha_fin: string | null;
}

interface ReporteCal {
  orden_id: string;
  numero_orden: string;
  area: string;
  comp_idx: number;
  nombre: string;
  hecho: number;
  delta: number;
  meta: number | null;
  usuario_nombre: string | null;
  creado_en: string;
}

const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

// Clave 'YYYY-MM-DD' en hora LOCAL (la del turno de la planta).
function claveDia(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${dia}`;
}

function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

export default function CalendarioPage() {
  const { sesion } = useSession();
  const hoy = new Date();
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [mes, setMes] = useState(hoy.getMonth()); // 0-11
  const [ordenes, setOrdenes] = useState<OrdenCal[]>([]);
  const [reportes, setReportes] = useState<ReporteCal[]>([]);
  const [cargando, setCargando] = useState(true);
  const [diaSel, setDiaSel] = useState<string | null>(claveDia(hoy));

  const mesStr = `${anio}-${String(mes + 1).padStart(2, '0')}`;

  const cargar = useCallback(async () => {
    if (!sesion?.email) return;
    setCargando(true);
    try {
      const res = await fetch(`/api/calendario?mes=${mesStr}`, {
        headers: { 'x-user-email': sesion.email },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setOrdenes(data.ordenes as OrdenCal[]);
        setReportes(data.reportes as ReporteCal[]);
      }
    } finally {
      setCargando(false);
    }
  }, [mesStr, sesion?.email]);

  useEffect(() => { cargar(); }, [cargar]);

  function cambiarMes(delta: number) {
    const d = new Date(anio, mes + delta, 1);
    setAnio(d.getFullYear());
    setMes(d.getMonth());
    setDiaSel(null);
  }

  // ── Índices por día ─────────────────────────────────────────────────────────
  const porDia = useMemo(() => {
    const inicios = new Map<string, OrdenCal[]>();
    const fines = new Map<string, OrdenCal[]>();
    const reps = new Map<string, ReporteCal[]>();
    for (const o of ordenes) {
      if (o.fecha_inicio) {
        const k = claveDia(new Date(o.fecha_inicio));
        (inicios.get(k) ?? inicios.set(k, []).get(k)!).push(o);
      }
      if (o.fecha_fin) {
        const k = claveDia(new Date(o.fecha_fin));
        (fines.get(k) ?? fines.set(k, []).get(k)!).push(o);
      }
    }
    for (const r of reportes) {
      const k = claveDia(new Date(r.creado_en));
      (reps.get(k) ?? reps.set(k, []).get(k)!).push(r);
    }
    return { inicios, fines, reps };
  }, [ordenes, reportes]);

  // ── Celdas del mes (lunes primero) ──────────────────────────────────────────
  const celdas = useMemo(() => {
    const primerDia = new Date(anio, mes, 1);
    const diasEnMes = new Date(anio, mes + 1, 0).getDate();
    const offset = (primerDia.getDay() + 6) % 7; // Lun=0 … Dom=6
    const out: (string | null)[] = Array(offset).fill(null);
    for (let d = 1; d <= diasEnMes; d++) out.push(claveDia(new Date(anio, mes, d)));
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [anio, mes]);

  const claveHoy = claveDia(hoy);

  return (
    <div className="p-4 lg:p-6 max-w-6xl mx-auto space-y-5 pb-12">
      {/* Header */}
      <div>
        <Link href="/produccion" className="flex items-center gap-1.5 text-sm text-[#6B716C] hover:text-[#1A1A1A] transition-colors mb-3">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Producción
        </Link>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl lg:text-2xl font-semibold text-[#1A1A1A] mb-0.5">Calendario de producción</h1>
            <p className="text-sm text-[#6B716C]">Inicios y cierres de órdenes, avance diario y bitácora de reportes por área.</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => cambiarMes(-1)} className="w-8 h-8 rounded-lg border border-[#E2E5E2] hover:bg-[#F6F8F1] flex items-center justify-center text-[#6B716C]">←</button>
            <span className="text-sm font-semibold text-[#1A1A1A] min-w-[140px] text-center">{MESES[mes]} {anio}</span>
            <button onClick={() => cambiarMes(1)} className="w-8 h-8 rounded-lg border border-[#E2E5E2] hover:bg-[#F6F8F1] flex items-center justify-center text-[#6B716C]">→</button>
          </div>
        </div>
      </div>

      {/* Grid mensual */}
      <div className="bg-white border border-[#E2E5E2] rounded-xl shadow-card overflow-hidden">
        <div className="grid grid-cols-7 border-b border-[#E8EFE9] bg-[#F8FAF8]">
          {DIAS_SEMANA.map(d => (
            <div key={d} className="py-2 text-center text-[10px] uppercase tracking-wide text-[#8A9A8C] font-medium">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {celdas.map((k, i) => {
            if (!k) return <div key={i} className="min-h-[72px] lg:min-h-[92px] border-b border-r border-[#F0F5F0] bg-[#FBFCFB]" />;
            const inicios = porDia.inicios.get(k) ?? [];
            const fines = porDia.fines.get(k) ?? [];
            const reps = porDia.reps.get(k) ?? [];
            const piezasDia = reps.reduce((s, r) => s + r.delta, 0);
            const esHoy = k === claveHoy;
            const sel = k === diaSel;
            return (
              <button
                key={i}
                onClick={() => setDiaSel(k)}
                className={`min-h-[72px] lg:min-h-[92px] border-b border-r border-[#F0F5F0] p-1.5 text-left align-top transition-colors ${
                  sel ? 'bg-brand-green-50 ring-1 ring-inset ring-brand-green/40' : 'hover:bg-[#F8FAF8]'
                }`}
              >
                <div className={`text-[11px] font-semibold mb-1 ${esHoy ? 'inline-flex w-5 h-5 items-center justify-center rounded-full bg-brand-green text-white' : 'text-[#6B716C]'}`}>
                  {Number(k.slice(-2))}
                </div>
                <div className="space-y-0.5">
                  {inicios.map(o => (
                    <div key={`i${o.id}`} className="flex items-center gap-1 text-[9px] leading-tight font-mono font-semibold text-[#1A6B4A] truncate">
                      <span className="w-1.5 h-1.5 rounded-full bg-brand-green flex-shrink-0" />
                      {o.numero_orden}
                    </div>
                  ))}
                  {fines.map(o => (
                    <div key={`f${o.id}`} className="flex items-center gap-1 text-[9px] leading-tight font-mono font-semibold text-[#6B716C] truncate">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#9AA89C] flex-shrink-0" />
                      {o.numero_orden}
                    </div>
                  ))}
                  {piezasDia > 0 && (
                    <div className="text-[9px] leading-tight text-[#8A9A8C]">+{piezasDia.toLocaleString()} pzs · {reps.length} rep.</div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {cargando && <p className="text-sm text-[#6B716C]">Cargando actividad del mes…</p>}

      {/* Detalle del día seleccionado */}
      {diaSel && <DetalleDia dia={diaSel} inicios={porDia.inicios.get(diaSel) ?? []} fines={porDia.fines.get(diaSel) ?? []} reportes={porDia.reps.get(diaSel) ?? []} />}
    </div>
  );
}

// ─── Detalle de un día ──────────────────────────────────────────────────────────

function DetalleDia({ dia, inicios, fines, reportes }: {
  dia: string; inicios: OrdenCal[]; fines: OrdenCal[]; reportes: ReporteCal[];
}) {
  const fecha = new Date(`${dia}T12:00:00`);
  const titulo = fecha.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  // Avance del día por orden → área → componentes (suma de deltas).
  const resumen = useMemo(() => {
    const porOrden = new Map<string, { numero: string; areas: Map<string, { total: number; comps: Map<string, number> }> }>();
    for (const r of reportes) {
      const o = porOrden.get(r.orden_id) ?? { numero: r.numero_orden, areas: new Map() };
      porOrden.set(r.orden_id, o);
      const a = o.areas.get(r.area) ?? { total: 0, comps: new Map<string, number>() };
      o.areas.set(r.area, a);
      a.total += r.delta;
      a.comps.set(r.nombre, (a.comps.get(r.nombre) ?? 0) + r.delta);
    }
    return porOrden;
  }, [reportes]);

  // Bitácora ORGANIZADA POR ÁREA: dentro de cada área, entradas cronológicas.
  // Reportes consecutivos del mismo usuario/orden (dentro de 10 min) forman
  // UNA entrada con su tabla de componentes.
  const bitacoraPorArea = useMemo(() => {
    const cronologico = [...reportes].sort((a, b) => a.creado_en.localeCompare(b.creado_en));
    const porArea = new Map<string, { hora: string; usuario: string; numero: string; ordenId: string; filas: ReporteCal[] }[]>();
    for (const r of cronologico) {
      let grupos = porArea.get(r.area);
      if (!grupos) {
        grupos = [];
        porArea.set(r.area, grupos);
      }
      const ultimo = grupos[grupos.length - 1];
      const mismo =
        ultimo &&
        ultimo.usuario === (r.usuario_nombre ?? '—') &&
        ultimo.numero === r.numero_orden &&
        new Date(r.creado_en).getTime() - new Date(ultimo.filas[0].creado_en).getTime() < 10 * 60 * 1000;
      if (mismo) {
        ultimo.filas.push(r);
      } else {
        grupos.push({ hora: hora(r.creado_en), usuario: r.usuario_nombre ?? '—', numero: r.numero_orden, ordenId: r.orden_id, filas: [r] });
      }
    }
    return [...porArea.entries()].sort(
      (a, b) => AREAS_FLOW.indexOf(a[0] as Area) - AREAS_FLOW.indexOf(b[0] as Area),
    );
  }, [reportes]);

  const totalReportes = bitacoraPorArea.reduce((s, [, g]) => s + g.length, 0);
  const vacio = inicios.length === 0 && fines.length === 0 && reportes.length === 0;

  return (
    <div className="bg-white border border-[#E2E5E2] rounded-xl shadow-card overflow-hidden">
      <div className="px-4 py-2.5 border-b border-[#E8EFE9] bg-brand-green-50/40">
        <h2 className="text-sm font-semibold text-[#1A1A1A] capitalize">{titulo}</h2>
      </div>
      <div className="p-4 space-y-5">
        {vacio && <p className="text-sm text-[#8A9A8C]">Sin actividad registrada este día.</p>}

        {/* Inicios y cierres */}
        {(inicios.length > 0 || fines.length > 0) && (
          <div className="flex flex-wrap gap-2">
            {inicios.map(o => (
              <Link key={`i${o.id}`} href={`/ordenes/${o.id}`} className="text-xs bg-brand-green-light text-[#1A1A1A] rounded-lg px-3 py-1.5 hover:opacity-80">
                <span className="font-mono font-bold">{o.numero_orden}</span> inició {o.fecha_inicio ? hora(o.fecha_inicio) : ''} · {o.cliente} · {o.cantidad.toLocaleString()} sacos
              </Link>
            ))}
            {fines.map(o => (
              <Link key={`f${o.id}`} href={`/ordenes/${o.id}`} className="text-xs bg-[#E0E7E1] text-[#1A1A1A] rounded-lg px-3 py-1.5 hover:opacity-80">
                <span className="font-mono font-bold">{o.numero_orden}</span> terminó {o.fecha_fin ? hora(o.fecha_fin) : ''}
              </Link>
            ))}
          </div>
        )}

        {/* Avance del día por orden/área */}
        {resumen.size > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-[#1A1A1A] uppercase tracking-wide mb-2">Avance del día</h3>
            <div className="space-y-3">
              {[...resumen.entries()].map(([ordenId, o]) => (
                <div key={ordenId} className="border border-[#E8EFE9] rounded-lg p-3">
                  <Link href={`/ordenes/${ordenId}`} className="text-sm font-bold font-mono text-[#1A1A1A] hover:underline">{o.numero}</Link>
                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {[...o.areas.entries()].map(([area, a]) => {
                      const c = AREA_COLORS[area as Area] ?? { bg: 'bg-[#F6F8F1]', text: 'text-[#1A1A1A]' };
                      return (
                        <div key={area} className="text-xs">
                          <span className={`inline-flex px-2 py-0.5 rounded font-semibold ${c.bg} ${c.text}`}>
                            {AREA_LABELS[area as Area] ?? area}
                          </span>
                          <span className="ml-1.5 font-mono font-bold text-[#1A1A1A]">
                            {a.total >= 0 ? '+' : ''}{a.total.toLocaleString()} pzs
                          </span>
                          <div className="text-[11px] text-[#6B716C] mt-0.5">
                            {[...a.comps.entries()].map(([n, d]) => `${n} ${d >= 0 ? '+' : ''}${d.toLocaleString()}`).join(' · ')}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Bitácora de reportes, organizada por área */}
        {totalReportes > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-[#1A1A1A] uppercase tracking-wide mb-2">
              Bitácora de reportes por área ({totalReportes})
            </h3>
            <div className="space-y-4">
              {bitacoraPorArea.map(([area, grupos]) => {
                const c = AREA_COLORS[area as Area] ?? { bg: 'bg-[#F6F8F1]', text: 'text-[#1A1A1A]' };
                return (
                  <div key={area} className="border border-[#E8EFE9] rounded-lg overflow-hidden">
                    <div className={`px-3 py-2 flex items-center justify-between ${c.bg}`}>
                      <span className={`text-xs font-bold ${c.text}`}>{AREA_LABELS[area as Area] ?? area}</span>
                      <span className={`text-[10px] ${c.text} opacity-70`}>
                        {grupos.length} {grupos.length === 1 ? 'reporte' : 'reportes'}
                      </span>
                    </div>
                    <div className="divide-y divide-[#F0F5F0]">
                      {grupos.map((g, i) => (
                        <div key={i} className="px-3 py-2.5">
                          <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
                            <span className="font-mono font-bold text-[#1A1A1A]">{g.hora}</span>
                            <span className="font-semibold text-[#1A1A1A]">{g.usuario}</span>
                            <span className="text-[#8A9A8C]">reportó en</span>
                            <Link href={`/ordenes/${g.ordenId}`} className="font-mono text-[#6B716C] hover:underline">
                              {g.numero}
                            </Link>
                          </div>
                          <div className="mt-1.5 overflow-x-auto">
                            <table className="text-[11px] w-full max-w-md border-collapse">
                              <thead>
                                <tr className="text-left text-[9px] uppercase tracking-wide text-[#8A9A8C]">
                                  <th className="py-0.5 pr-3 font-medium">Elemento</th>
                                  <th className="py-0.5 pr-3 font-medium text-right">Avance</th>
                                  <th className="py-0.5 font-medium text-right">Acumulado</th>
                                </tr>
                              </thead>
                              <tbody>
                                {g.filas.map((f, j) => (
                                  <tr key={j} className="border-t border-[#F5F8F5]">
                                    <td className="py-0.5 pr-3 text-[#6B716C]">{f.nombre}</td>
                                    <td className={`py-0.5 pr-3 text-right font-mono font-semibold ${f.delta >= 0 ? 'text-[#1A6B4A]' : 'text-red-600'}`}>
                                      {f.delta >= 0 ? '+' : ''}{f.delta.toLocaleString()}
                                    </td>
                                    <td className="py-0.5 text-right font-mono text-[#1A1A1A]">
                                      {f.hecho.toLocaleString()}
                                      {f.meta != null && <span className="text-[#8A9A8C]"> / {f.meta.toLocaleString()}</span>}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
