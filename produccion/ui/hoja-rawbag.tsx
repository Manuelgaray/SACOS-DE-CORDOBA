'use client';

// ─────────────────────────────────────────────────────────────────────────────
//  REPORTE DE PRODUCCIÓN DE RAW BAG Y TAPA — captura oficial de Big y Tapa.
//
//  Réplica de la hoja física: un renglón por operador/máquina con la actividad
//  realizada y su producción en bloques de 2 horas (08, 10, 12 y 14 h), total
//  por renglón y observaciones. Cada día es una hoja. El avance de las áreas se
//  mide por operaciones terminadas (el check de cada renglón).
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useProduccion } from '@/produccion/produccion-store';import BotonImprimir from '@/produccion/ui/BotonImprimir';
import { useSession } from '@/autenticacion/auth';
import { AREA_LABELS } from '@/compartido/mock-data';
import type { AvanceArea } from '@/produccion/produccion';
import NumeroInput from '@/compartido/ui/NumeroInput';
import { ConfirmModal } from '@/compartido/ui/Modal';
import PestanasHoja from '@/produccion/ui/PestanasHoja';

// Bloques de horario de la hoja física.
const BLOQUES = [
  { campo: 'p08', label: '08:00' },
  { campo: 'p10', label: '10:00' },
  { campo: 'p12', label: '12:00' },
  { campo: 'p14', label: '14:00' },
] as const;

type CampoBloque = (typeof BLOQUES)[number]['campo'];

// Actividades frecuentes (sugerencias; el campo acepta cualquier texto).
const ACTIVIDADES = ['BASE', 'UNIÓN', 'TAPA', 'FALDÓN', 'RAW BAG'];

interface RenglonRB {
  id: number;
  fecha: string;
  maquina: string;
  operador: string;
  actividad: string;
  p08: number;
  p10: number;
  p12: number;
  p14: number;
  observaciones: string;
  terminado: boolean;
}

function hoyLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fechaBonita(f: string): string {
  return new Date(`${f}T12:00:00`).toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' });
}

const celda = 'px-2 py-1 border-r border-[#E8EFE9] last:border-r-0';
const inp =
  'w-full px-1.5 py-1 text-xs border border-transparent rounded bg-transparent hover:border-[#E2E5E2] focus:bg-white focus:border-brand-green focus:outline-none focus:ring-1 focus:ring-brand-green/30 transition-colors disabled:hover:border-transparent';

export default function HojaRawbagPage() {
  const { ordenes, estados, avances, ready, setAvancesOrden, patchOrden } = useProduccion();
  const { sesion } = useSession();
  const router = useRouter();

  // La orden viene fija por la URL (?orden=).
  const [ordenId, setOrdenId] = useState('');
  const [paramListo, setParamListo] = useState(false);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get('orden');
    if (p) setOrdenId(p);
    setParamListo(true);
  }, []);

  const orden = ordenes.find(o => o.id === ordenId);
  const est = orden ? (estados[orden.id] ?? orden.status) : null;
  const bloqueo = !orden
    ? null
    : est !== 'activa'
    ? (est === 'terminada' ? 'Orden terminada: la hoja quedó cerrada (solo consulta).' : 'Orden pausada: la captura se reanuda cuando un administrador la active.')
    : !orden.autorizado_por
    ? 'Pendiente de autorización: un administrador debe autorizar la orden antes de capturar.'
    : null;
  const puede =
    sesion?.rol === 'admin' ||
    (sesion?.rol === 'supervisor' && (sesion.area_asignada === 'big' || sesion.area_asignada === 'tapa'));
  const editable = !!orden && !!puede && !bloqueo;

  const [renglones, setRenglones] = useState<RenglonRB[]>([]);
  // Actividades marcadas como terminadas (el avance se mide con esto).
  const [terminadas, setTerminadas] = useState<string[]>([]);
  const [cargando, setCargando] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [avisoCierre, setAvisoCierre] = useState(false);
  const [aEliminar, setAEliminar] = useState<RenglonRB | null>(null);
  const [eliminando, setEliminando] = useState(false);

  const headers = useCallback(
    () => ({ 'Content-Type': 'application/json', 'x-user-email': sesion?.email ?? '' }),
    [sesion?.email],
  );

  useEffect(() => {
    if (!orden?.id || !sesion?.email) return;
    let cancelado = false;
    setCargando(true);
    fetch(`/api/hoja-rawbag?orden=${encodeURIComponent(orden.id)}`, { headers: { 'x-user-email': sesion.email } })
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (cancelado || !data) return;
        setRenglones(data.renglones as RenglonRB[]);
        setTerminadas((data.terminadas as string[]) ?? []);
      })
      .catch(() => {})
      .finally(() => { if (!cancelado) setCargando(false); });
    return () => { cancelado = true; };
  }, [orden?.id, sesion?.email]);

  const aplicarRespuesta = useCallback((data: {
    avances?: { area: string; componentes: { nombre: string; meta: number; hecho: number }[] }[];
    ordenTerminada?: boolean;
    fechaFin?: string | null;
  }) => {
    if (!orden) return;
    if (Array.isArray(data.avances)) {
      const actuales = avances[orden.id] ?? [];
      const nuevos: AvanceArea[] = actuales.map(a => {
        const upd = data.avances!.find(x => x.area === a.area);
        return upd
          ? { ...a, componentes: upd.componentes, ultimoReporte: { fecha: new Date().toISOString(), usuario: sesion?.nombre ?? null } }
          : a;
      });
      setAvancesOrden(orden.id, nuevos);
    }
    if (data.ordenTerminada) {
      patchOrden(orden.id, { status: 'terminada', fecha_fin: data.fechaFin ?? null });
      setAvisoCierre(true);
    }
  }, [orden, avances, setAvancesOrden, patchOrden, sesion?.nombre]);

  // ── Hojas por día ───────────────────────────────────────────────────────────
  const [diaSel, setDiaSel] = useState(hoyLocal());
  const dias = useMemo(() => {
    const s = new Set<string>(renglones.map(r => r.fecha));
    s.add(hoyLocal());
    return [...s].sort().reverse();
  }, [renglones]);
  const delDia = useMemo(
    () => renglones.filter(r => r.fecha === diaSel).sort((a, b) => a.id - b.id),
    [renglones, diaSel],
  );

  // ── Acciones ────────────────────────────────────────────────────────────────
  async function agregarRenglon() {
    if (!orden) return;
    setMsg(null);
    const res = await fetch('/api/hoja-rawbag', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ orden_id: orden.id, fecha: diaSel }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setMsg(data?.error ?? 'No se pudo agregar el renglón.'); return; }
    setRenglones(prev => [...prev, data.renglon as RenglonRB]);
    aplicarRespuesta(data);
  }

  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  function guardar(id: number) {
    const previo = timers.current.get(id);
    if (previo) clearTimeout(previo);
    timers.current.set(id, setTimeout(() => {
      timers.current.delete(id);
      setRenglones(prev => {
        const r = prev.find(x => x.id === id);
        if (r) {
          fetch(`/api/hoja-rawbag/${id}`, {
            method: 'PUT',
            headers: headers(),
            body: JSON.stringify(r),
            keepalive: true,
          })
            .then(res => res.json().catch(() => ({})).then(data => {
              if (!res.ok) { setMsg(data?.error ?? 'No se pudo guardar el renglón.'); return; }
              aplicarRespuesta(data);
            }))
            .catch(() => setMsg('No se pudo conectar con el servidor.'));
        }
        return prev;
      });
    }, 800));
  }

  function actualizar(id: number, campo: keyof RenglonRB, valor: string | number | boolean) {
    setRenglones(prev => prev.map(r => (r.id === id ? { ...r, [campo]: valor } : r)));
    guardar(id);
  }

  async function eliminar() {
    if (!aEliminar) return;
    setEliminando(true);
    try {
      const res = await fetch(`/api/hoja-rawbag/${aEliminar.id}`, { method: 'DELETE', headers: headers() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg(data?.error ?? 'No se pudo eliminar.'); return; }
      setRenglones(prev => prev.filter(r => r.id !== aEliminar.id));
      aplicarRespuesta(data);
    } finally {
      setEliminando(false);
      setAEliminar(null);
    }
  }

  // ── Totales y avance ────────────────────────────────────────────────────────
  const totalDe = (r: RenglonRB) => r.p08 + r.p10 + r.p12 + r.p14;
  const totalBloque = (campo: CampoBloque) => delDia.reduce((s, r) => s + r[campo], 0);
  const totalDia = delDia.reduce((s, r) => s + totalDe(r), 0);

  // ── Actividades de la orden ─────────────────────────────────────────────────
  // Se suman los totales de TODOS los días y operarios por actividad, así no
  // importa en cuántas hojas se haya dividido el trabajo.
  const actividades = useMemo(() => {
    const m = new Map<string, { total: number; renglones: number }>();
    for (const r of renglones) {
      const act = r.actividad.trim().toUpperCase();
      if (!act) continue;
      const acc = m.get(act) ?? { total: 0, renglones: 0 };
      acc.total += totalDe(r);
      acc.renglones += 1;
      m.set(act, acc);
    }
    return [...m.entries()]
      .map(([actividad, d]) => ({ actividad, ...d, terminada: terminadas.includes(actividad) }))
      .sort((a, b) => a.actividad.localeCompare(b.actividad, 'es'));
  }, [renglones, terminadas]);

  const actListas = actividades.filter(a => a.terminada).length;
  const actPct = actividades.length > 0 ? Math.round((actListas / actividades.length) * 100) : 0;

  async function marcarActividad(actividad: string, terminado: boolean) {
    if (!orden) return;
    setTerminadas(prev => (terminado ? [...prev, actividad] : prev.filter(a => a !== actividad)));
    const res = await fetch('/api/hoja-rawbag', {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify({ orden_id: orden.id, actividad, terminado }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(data?.error ?? 'No se pudo marcar la actividad.');
      // Revertir si el servidor la rechazó.
      setTerminadas(prev => (terminado ? prev.filter(a => a !== actividad) : [...prev, actividad]));
      return;
    }
    aplicarRespuesta(data);
  }

  // Pestañas tipo hoja de cálculo. La verificación es exclusiva de Big, así que
  // el supervisor de Tapa solo ve la hoja de producción (sin pestañas).
  const verVerificacion = sesion?.rol === 'admin' || sesion?.area_asignada === 'big';
  const pestanas = verVerificacion && orden
    ? [
        { href: `/produccion/hoja-rawbag?orden=${orden.id}`, label: 'Reporte de producción' },
        { href: `/produccion/hoja-verif-rawbag?orden=${orden.id}`, label: 'Verificación de área' },
      ]
    : [];

  if (!ready || !paramListo) return <div className="p-6 text-sm text-[#6B716C]">Cargando…</div>;

  if (!orden) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="bg-white border border-[#E2E5E2] rounded-xl p-8 text-center shadow-card">
          <p className="text-sm text-[#6B716C] mb-4">
            Esta hoja pertenece a una orden específica. Elige la orden desde Big o Tapa.
          </p>
          <Link
            href="/produccion/big"
            className="inline-flex text-sm font-semibold text-white bg-brand-green hover:bg-brand-green-dark rounded-lg px-4 py-2 transition-colors"
          >
            Ir al área de Big
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 max-w-[1300px] mx-auto space-y-4 pb-12">
      <div>
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-sm text-[#6B716C] hover:text-[#1A1A1A] transition-colors mb-3"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Regresar
        </button>
        <h1 className="text-xl lg:text-2xl font-semibold text-[#1A1A1A]">
          Reporte de producción de Raw Bag y Tapa
        </h1>
        <p className="text-sm text-[#6B716C]">
          Hoja compartida por {AREA_LABELS.big} y {AREA_LABELS.tapa}: producción por operador en
          bloques de 2 horas.
        </p>
        <BotonImprimir orden={orden.id} hoja="rawbag" permitido={puede} />
      </div>

      <PestanasHoja pestanas={pestanas} activa="Reporte de producción" />

      {bloqueo && (
        <div className="bg-[#FFF7E8] border border-[#E8C88A] rounded-xl px-4 py-3 text-xs text-[#6B5418]">
          <span className="font-semibold">Solo consulta.</span> {bloqueo}
        </div>
      )}
      {!bloqueo && !puede && (
        <div className="bg-[#FFF7E8] border border-[#E8C88A] rounded-xl px-4 py-3 text-xs text-[#6B5418]">
          <span className="font-semibold">Solo consulta.</span> La hoja la capturan los supervisores de Big o Tapa (o el administrador).
        </div>
      )}
      {msg && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-[#1A1A1A]">{msg}</div>}
      {avisoCierre && (
        <div className="bg-brand-green-light border border-brand-green rounded-xl px-4 py-3 text-xs text-[#1A1A1A]">
          <span className="font-bold text-[#047150]">Orden TERMINADA.</span>{' '}
          Todas las áreas alcanzaron el 100 %, así que la orden se cerró automáticamente.
        </div>
      )}

      {/* Encabezado de la hoja */}
      <div className="bg-white border border-[#E2E5E2] rounded-xl shadow-card p-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <Dato label="# Orden de trabajo" valor={orden.numero_orden} mono />
          <Dato label="Cliente" valor={orden.cliente} />
          <Dato label="Estilo del saco" valor={orden.tipo_saco} />
          <Dato label="Medidas" valor={orden.medida} mono />
        </div>

        {/* Hojas por día */}
        <div className="mt-3 pt-3 border-t border-[#F0F5F0] flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] uppercase tracking-wide text-[#8A9A8C] mr-1">Fecha:</span>
          {dias.map(d => (
            <button
              key={d}
              onClick={() => setDiaSel(d)}
              className={`text-[11px] rounded-lg px-2.5 py-1 border transition-colors capitalize ${
                d === diaSel
                  ? 'bg-brand-green text-white border-brand-green font-semibold'
                  : 'border-[#E2E5E2] text-[#6B716C] hover:bg-[#F6F8F1]'
              }`}
            >
              {fechaBonita(d)}
            </button>
          ))}
        </div>
      </div>

      {/* La tabla del día */}
      <div className="bg-white border border-[#E2E5E2] rounded-xl shadow-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-xs border-collapse">
            <thead>
              <tr className="bg-[#F8FAF8] text-[9px] uppercase tracking-wide text-[#8A9A8C] border-b border-[#E2E5E2]">
                <th className={`${celda} font-medium w-20`}>N° de máquina</th>
                <th className={`${celda} text-left font-medium w-40`}>Operador</th>
                <th className={`${celda} text-left font-medium w-36`}>Actividad realizada</th>
                {BLOQUES.map(b => (
                  <th key={b.campo} className={`${celda} font-medium w-20`}>{b.label}</th>
                ))}
                <th className={`${celda} font-medium w-20 bg-[#F0F5F0]`}>Total</th>
                <th className={`${celda} text-left font-medium`} style={{ minWidth: 160 }}>Observaciones</th>
                <th className={`${celda} w-8`} />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0F5F0]">
              {delDia.map(r => (
                <tr key={r.id} className="hover:bg-[#FBFCFB]">
                  <td className={celda}>
                    <input disabled={!editable} className={`${inp} text-center font-mono`} value={r.maquina}
                      placeholder="#" onChange={e => actualizar(r.id, 'maquina', e.target.value)} />
                  </td>
                  <td className={celda}>
                    <input disabled={!editable} className={inp} value={r.operador}
                      placeholder="Nombre" onChange={e => actualizar(r.id, 'operador', e.target.value)} />
                  </td>
                  <td className={celda}>
                    <input disabled={!editable} list="actividades-rawbag" className={inp} value={r.actividad}
                      placeholder="Ej. UNIÓN" onChange={e => actualizar(r.id, 'actividad', e.target.value.toUpperCase())} />
                  </td>
                  {BLOQUES.map(b => (
                    <td key={b.campo} className={celda}>
                      <NumeroInput
                        disabled={!editable}
                        valor={r[b.campo]}
                        onValor={v => actualizar(r.id, b.campo, parseInt(v, 10) || 0)}
                        className={`${inp} text-right font-mono`}
                      />
                    </td>
                  ))}
                  <td className={`${celda} text-right font-mono font-bold text-[#1A1A1A] bg-[#F8FAF8]`}>
                    {totalDe(r).toLocaleString()}
                  </td>
                  <td className={celda}>
                    <input disabled={!editable} className={inp} value={r.observaciones}
                      placeholder="—" onChange={e => actualizar(r.id, 'observaciones', e.target.value)} />
                  </td>
                  <td className={`${celda} text-center`}>
                    {editable && (
                      <button onClick={() => setAEliminar(r)} title="Quitar renglón" className="text-[#8A9A8C] hover:text-red-600 transition-colors">✕</button>
                    )}
                  </td>
                </tr>
              ))}
              {delDia.length === 0 && !cargando && (
                <tr><td colSpan={10} className="py-6 text-center text-xs text-[#8A9A8C]">
                  Hoja del {fechaBonita(diaSel)} sin renglones{editable ? ' — agrega el primero.' : '.'}
                </td></tr>
              )}
              {cargando && (
                <tr><td colSpan={10} className="py-6 text-center text-xs text-[#8A9A8C]">Cargando hoja…</td></tr>
              )}
            </tbody>
            {delDia.length > 0 && (
              <tfoot className="border-t-2 border-[#E2E5E2]">
                <tr className="bg-[#F8FAF8]">
                  <td className={`${celda} text-[10px] font-semibold text-[#6B716C]`} colSpan={3}>
                    Total de piezas del día
                  </td>
                  {BLOQUES.map(b => (
                    <td key={b.campo} className={`${celda} text-right font-mono font-bold text-[#1A1A1A]`}>
                      {totalBloque(b.campo).toLocaleString()}
                    </td>
                  ))}
                  <td className={`${celda} text-right font-mono font-bold text-[#1A1A1A]`}>
                    {totalDia.toLocaleString()}
                  </td>
                  <td className={celda} colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        {editable && (
          <div className="px-3 py-2.5 border-t border-[#E8EFE9]">
            <button
              onClick={agregarRenglon}
              className="text-xs font-semibold text-white bg-brand-green hover:bg-brand-green-dark rounded-lg px-4 py-2 transition-colors"
            >
              + Agregar renglón
            </button>
          </div>
        )}
      </div>

      <datalist id="actividades-rawbag">
        {ACTIVIDADES.map(a => <option key={a} value={a} />)}
      </datalist>

      {/* Avance por ACTIVIDAD: suma de todos los días y operarios */}
      <div className="bg-white border border-[#E2E5E2] rounded-xl shadow-card p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="text-xs font-semibold text-[#1A1A1A] uppercase tracking-wide">
            Avance por actividad · {AREA_LABELS.big} y {AREA_LABELS.tapa}
          </h3>
          <span className="text-xs font-mono font-bold text-[#1A1A1A]">
            {actListas} de {actividades.length} actividades ({actPct}%)
          </span>
        </div>

        {actividades.length === 0 ? (
          <p className="text-xs text-[#8A9A8C]">
            Captura renglones con su actividad y aquí aparecerá una barra por cada una,
            sumando todos los días.
          </p>
        ) : (
          <div className="space-y-3">
            {actividades.map(a => {
              const pct = orden.cantidad > 0 ? Math.min(100, Math.round((a.total / orden.cantidad) * 100)) : 0;
              return (
                <div key={a.actividad}>
                  <div className="flex items-center justify-between gap-3 mb-1 flex-wrap">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        disabled={!editable}
                        checked={a.terminada}
                        onChange={e => marcarActividad(a.actividad, e.target.checked)}
                        className="accent-[#009166] w-4 h-4 cursor-pointer"
                      />
                      <span className={`text-xs font-bold ${a.terminada ? 'text-[#047150]' : 'text-[#1A1A1A]'}`}>
                        {a.actividad}
                      </span>
                      {a.terminada && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-brand-green-light text-[#047150]">
                          TERMINADA
                        </span>
                      )}
                    </label>
                    <span className="text-xs font-mono text-[#6B716C]">
                      <span className="font-bold text-[#1A1A1A]">{a.total.toLocaleString()}</span>
                      {' '}pzas · {a.renglones} {a.renglones === 1 ? 'renglón' : 'renglones'}
                    </span>
                  </div>
                  <div className="h-2 bg-[#E8EFE9] rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${a.terminada ? 'bg-brand-green' : 'bg-brand-orange'}`}
                      style={{ width: `${a.terminada ? 100 : pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <p className="text-[10px] text-[#8A9A8C] mt-3">
          Cada barra suma las piezas de todos los días y operarios de esa actividad (referencia:
          los {orden.cantidad.toLocaleString()} sacos de la orden). Marca la casilla cuando la
          actividad esté completa: el área llega al 100 % con todas marcadas, sin importar en
          cuántas hojas se dividió el trabajo.
        </p>
      </div>

      <ConfirmModal
        open={!!aEliminar}
        onClose={() => setAEliminar(null)}
        onConfirm={eliminar}
        titulo="Quitar renglón"
        variante="peligro"
        confirmarTexto="Quitar"
        cargando={eliminando}
      >
        ¿Quitar el renglón de <span className="font-semibold text-[#1A1A1A]">{aEliminar?.operador || 'sin operador'}</span>
        {aEliminar?.actividad ? <> ({aEliminar.actividad})</> : null}? El avance se recalculará.
      </ConfirmModal>
    </div>
  );
}

function Dato({ label, valor, mono }: { label: string; valor: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-[#8A9A8C] mb-1">{label}</div>
      <div className={`font-semibold text-[#1A1A1A] ${mono ? 'font-mono' : ''}`}>{valor}</div>
    </div>
  );
}
