'use client';

// ─────────────────────────────────────────────────────────────────────────────
//  HOJA DE CONTROL DE MATERIAL — captura oficial de Small y Tips (compartida).
//
//  Réplica de la hoja física: matriz de material (renglones que el supervisor
//  describe libremente) × fechas (columnas), con las piezas entregadas en cada
//  día, el total por renglón y las firmas de quien entrega y quien recibe.
//  Los totales alimentan solos el avance de Small y Tips y la bitácora.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useProduccion } from '@/produccion/produccion-store';
import { useSession } from '@/autenticacion/auth';
import { AREA_LABELS } from '@/compartido/mock-data';
import type { AvanceArea } from '@/produccion/produccion';
import NumeroInput from '@/compartido/ui/NumeroInput';
import { ConfirmModal } from '@/compartido/ui/Modal';

interface RenglonMat {
  id: number;
  descripcion: string;
  entregas: Record<string, number>;
  // El supervisor marca que esa operación ya terminó (meta alcanzada).
  terminado: boolean;
}
interface ColumnaFecha {
  fecha: string;
  entrega: string;
  recibe: string;
}

function hoyLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fechaCorta(f: string): string {
  return new Date(`${f}T12:00:00`).toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

const celda = 'px-2 py-1 border-r border-[#E8EFE9] last:border-r-0';
const inp =
  'w-full px-1.5 py-1 text-xs border border-transparent rounded bg-transparent hover:border-[#E2E5E2] focus:bg-white focus:border-brand-green focus:outline-none focus:ring-1 focus:ring-brand-green/30 transition-colors disabled:hover:border-transparent';

export default function HojaMaterialPage() {
  const { ordenes, estados, avances, ready, setAvancesOrden, patchOrden } = useProduccion();
  const { sesion } = useSession();
  const router = useRouter();

  // La orden viene fija por la URL (?orden=), como en la hoja de corte.
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
    (sesion?.rol === 'supervisor' && (sesion.area_asignada === 'small' || sesion.area_asignada === 'tips'));
  const editable = !!orden && !!puede && !bloqueo;

  const [renglones, setRenglones] = useState<RenglonMat[]>([]);
  const [fechas, setFechas] = useState<ColumnaFecha[]>([]);
  const [cargando, setCargando] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [avisoCierre, setAvisoCierre] = useState(false);
  const [aEliminar, setAEliminar] = useState<RenglonMat | null>(null);
  const [fechaAEliminar, setFechaAEliminar] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const headers = useCallback(
    () => ({ 'Content-Type': 'application/json', 'x-user-email': sesion?.email ?? '' }),
    [sesion?.email],
  );

  useEffect(() => {
    if (!orden?.id || !sesion?.email) return;
    let cancelado = false;
    setCargando(true);
    fetch(`/api/hoja-material?orden=${encodeURIComponent(orden.id)}`, { headers: { 'x-user-email': sesion.email } })
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (cancelado || !data) return;
        setRenglones(data.renglones as RenglonMat[]);
        setFechas(data.fechas as ColumnaFecha[]);
      })
      .catch(() => {})
      .finally(() => { if (!cancelado) setCargando(false); });
    return () => { cancelado = true; };
  }, [orden?.id, sesion?.email]);

  // Aplica en pantalla lo que el servidor recalculó (avances de small/tips y el
  // posible cierre automático de la orden).
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

  // ── Acciones ────────────────────────────────────────────────────────────────
  async function agregarRenglon() {
    if (!orden) return;
    setMsg(null);
    // La fecha se pone sola: si aún no existe la columna de hoy, se crea.
    if (!fechas.some(f => f.fecha === hoyLocal())) await agregarFecha(hoyLocal());
    const res = await fetch('/api/hoja-material', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ orden_id: orden.id, descripcion: '' }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setMsg(data?.error ?? 'No se pudo agregar el material.'); return; }
    setRenglones(prev => [...prev, data.renglon as RenglonMat]);
  }

  async function agregarFecha(fecha: string) {
    if (!orden || fechas.some(f => f.fecha === fecha)) return;
    setMsg(null);
    const res = await fetch('/api/hoja-material', {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify({ orden_id: orden.id, fecha, entrega: '', recibe: '' }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setMsg(data?.error ?? 'No se pudo agregar la fecha.'); return; }
    setFechas(prev => [...prev, data.fecha as ColumnaFecha].sort((a, b) => a.fecha.localeCompare(b.fecha)));
  }

  // Guardado debounced por renglón.
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  function guardarRenglon(id: number) {
    const previo = timers.current.get(id);
    if (previo) clearTimeout(previo);
    timers.current.set(id, setTimeout(() => {
      timers.current.delete(id);
      setRenglones(prev => {
        const r = prev.find(x => x.id === id);
        if (r) {
          fetch(`/api/hoja-material/${id}`, {
            method: 'PUT',
            headers: headers(),
            body: JSON.stringify({ descripcion: r.descripcion, entregas: r.entregas, terminado: r.terminado }),
            keepalive: true,
          })
            .then(res => res.json().catch(() => ({})).then(data => {
              if (!res.ok) { setMsg(data?.error ?? 'No se pudo guardar.'); return; }
              aplicarRespuesta(data);
            }))
            .catch(() => setMsg('No se pudo conectar con el servidor.'));
        }
        return prev;
      });
    }, 800));
  }

  function setDescripcion(id: number, descripcion: string) {
    setRenglones(prev => prev.map(r => (r.id === id ? { ...r, descripcion } : r)));
    guardarRenglon(id);
  }
  function setTerminado(id: number, terminado: boolean) {
    setRenglones(prev => prev.map(r => (r.id === id ? { ...r, terminado } : r)));
    guardarRenglon(id);
  }
  function setPiezas(id: number, fecha: string, piezas: number) {
    setRenglones(prev => prev.map(r => {
      if (r.id !== id) return r;
      const entregas = { ...r.entregas };
      if (piezas > 0) entregas[fecha] = piezas; else delete entregas[fecha];
      return { ...r, entregas };
    }));
    guardarRenglon(id);
  }

  // Firmas por columna (debounced).
  const timersFecha = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  function setFirma(fecha: string, campo: 'entrega' | 'recibe', valor: string) {
    setFechas(prev => prev.map(f => (f.fecha === fecha ? { ...f, [campo]: valor } : f)));
    const previo = timersFecha.current.get(fecha);
    if (previo) clearTimeout(previo);
    timersFecha.current.set(fecha, setTimeout(() => {
      timersFecha.current.delete(fecha);
      setFechas(prev => {
        const f = prev.find(x => x.fecha === fecha);
        if (f && orden) {
          fetch('/api/hoja-material', {
            method: 'PUT',
            headers: headers(),
            body: JSON.stringify({ orden_id: orden.id, fecha, entrega: f.entrega, recibe: f.recibe }),
            keepalive: true,
          }).catch(() => setMsg('No se pudo guardar la firma.'));
        }
        return prev;
      });
    }, 800));
  }

  async function eliminarRenglon() {
    if (!aEliminar) return;
    setOcupado(true);
    try {
      const res = await fetch(`/api/hoja-material/${aEliminar.id}`, { method: 'DELETE', headers: headers() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg(data?.error ?? 'No se pudo eliminar.'); return; }
      setRenglones(prev => prev.filter(r => r.id !== aEliminar.id));
      aplicarRespuesta(data);
    } finally {
      setOcupado(false);
      setAEliminar(null);
    }
  }

  async function eliminarFecha() {
    if (!fechaAEliminar || !orden) return;
    setOcupado(true);
    try {
      const res = await fetch(
        `/api/hoja-material?orden=${encodeURIComponent(orden.id)}&fecha=${fechaAEliminar}`,
        { method: 'DELETE', headers: headers() },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg(data?.error ?? 'No se pudo eliminar la fecha.'); return; }
      setFechas(prev => prev.filter(f => f.fecha !== fechaAEliminar));
      setRenglones(prev => prev.map(r => {
        const entregas = { ...r.entregas };
        delete entregas[fechaAEliminar];
        return { ...r, entregas };
      }));
      aplicarRespuesta(data);
    } finally {
      setOcupado(false);
      setFechaAEliminar(null);
    }
  }

  const totalDe = (r: RenglonMat) => Object.values(r.entregas).reduce((s, n) => s + (Number(n) || 0), 0);
  const totalDia = (f: string) => renglones.reduce((s, r) => s + (Number(r.entregas[f]) || 0), 0);

  // El avance de estas áreas se mide por OPERACIONES de la hoja: el 100 % es
  // tener todos los renglones marcados como terminados.
  const opsListas = renglones.filter(r => r.terminado).length;
  const opsPct = renglones.length > 0 ? Math.round((opsListas / renglones.length) * 100) : 0;

  if (!ready || !paramListo) return <div className="p-6 text-sm text-[#6B716C]">Cargando…</div>;

  if (!orden) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="bg-white border border-[#E2E5E2] rounded-xl p-8 text-center shadow-card">
          <p className="text-sm text-[#6B716C] mb-4">
            Esta hoja pertenece a una orden específica. Elige la orden desde Small o Tips.
          </p>
          <Link
            href="/produccion/small"
            className="inline-flex text-sm font-semibold text-white bg-brand-green hover:bg-brand-green-dark rounded-lg px-4 py-2 transition-colors"
          >
            Ir al área de Small
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 max-w-[1400px] mx-auto space-y-4 pb-12">
      <div>
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-sm text-[#6B716C] hover:text-[#1A1A1A] transition-colors mb-3"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Regresar
        </button>
        <h1 className="text-xl lg:text-2xl font-semibold text-[#1A1A1A]">Control de material</h1>
        <p className="text-sm text-[#6B716C]">
          Hoja compartida por {AREA_LABELS.small} y {AREA_LABELS.tips}: describe el material y captura
          las piezas entregadas cada día.
        </p>
      </div>

      {bloqueo && (
        <div className="bg-[#FFF7E8] border border-[#E8C88A] rounded-xl px-4 py-3 text-xs text-[#6B5418]">
          <span className="font-semibold">Solo consulta.</span> {bloqueo}
        </div>
      )}
      {!bloqueo && !puede && (
        <div className="bg-[#FFF7E8] border border-[#E8C88A] rounded-xl px-4 py-3 text-xs text-[#6B5418]">
          <span className="font-semibold">Solo consulta.</span> La hoja la capturan los supervisores de Small o Tips (o el administrador).
        </div>
      )}
      {msg && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-[#1A1A1A]">{msg}</div>}
      {avisoCierre && (
        <div className="bg-brand-green-light border border-brand-green rounded-xl px-4 py-3 text-xs text-[#1A1A1A]">
          <span className="font-bold text-[#047150]">Orden TERMINADA.</span>{' '}
          Todas las áreas alcanzaron el 100 %, así que la orden se cerró automáticamente.
        </div>
      )}

      {/* Encabezado */}
      <div className="bg-white border border-[#E2E5E2] rounded-xl shadow-card p-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <Dato label="Cliente" valor={orden.cliente} />
          <Dato label="Número de orden" valor={orden.numero_orden} mono />
          <Dato label="Cantidad" valor={`${orden.cantidad.toLocaleString()} pz`} mono />
          <Dato label="Tipo de saco" valor={orden.tipo_saco} />
        </div>
      </div>

      {/* Matriz material × fechas */}
      <div className="bg-white border border-[#E2E5E2] rounded-xl shadow-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse" style={{ minWidth: 520 + fechas.length * 110 }}>
            <thead>
              <tr className="bg-[#F8FAF8] text-[9px] uppercase tracking-wide text-[#8A9A8C] border-b border-[#E2E5E2]">
                <th className={`${celda} text-left font-medium sticky left-0 bg-[#F8FAF8] z-10`} style={{ minWidth: 260 }}>
                  Descripción del material
                </th>
                {fechas.map(f => (
                  <th key={f.fecha} className={`${celda} font-medium`} style={{ minWidth: 100 }}>
                    <div className="flex items-center justify-center gap-1">
                      <span className="font-mono text-[10px] text-[#1A1A1A]">{fechaCorta(f.fecha)}</span>
                      {editable && (
                        <button onClick={() => setFechaAEliminar(f.fecha)} title="Quitar esta fecha" className="text-[#8A9A8C] hover:text-red-600">✕</button>
                      )}
                    </div>
                    <div className="font-normal normal-case">Piezas entregadas</div>
                  </th>
                ))}
                <th className={`${celda} font-medium bg-[#F0F5F0]`} style={{ minWidth: 90 }}>Total</th>
                <th className={`${celda} font-medium`} style={{ minWidth: 78 }}>Terminado</th>
                <th className={`${celda} w-8`} />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0F5F0]">
              {renglones.map(r => (
                  <tr key={r.id} className="hover:bg-[#FBFCFB]">
                    <td className={`${celda} sticky left-0 bg-white z-10`}>
                      <input
                        disabled={!editable}
                        className={inp}
                        value={r.descripcion}
                        placeholder="Ej. LATERAL 48x55&quot; 6oz CTO BCO."
                        onChange={e => setDescripcion(r.id, e.target.value)}
                      />

                    </td>
                    {fechas.map(f => (
                      <td key={f.fecha} className={celda}>
                        <NumeroInput
                          disabled={!editable}
                          valor={r.entregas[f.fecha] ?? 0}
                          onValor={v => setPiezas(r.id, f.fecha, parseInt(v, 10) || 0)}
                          className={`${inp} text-right font-mono`}
                        />
                      </td>
                    ))}
                    <td className={`${celda} text-right font-mono font-bold text-[#1A1A1A] bg-[#F8FAF8]`}>
                      {totalDe(r).toLocaleString()}
                    </td>
                    <td className={`${celda} text-center`}>
                      <input
                        type="checkbox"
                        disabled={!editable}
                        checked={r.terminado}
                        onChange={e => setTerminado(r.id, e.target.checked)}
                        title="Operación terminada: se alcanzó la meta"
                        className="accent-[#009166] w-4 h-4 cursor-pointer"
                      />
                    </td>
                    <td className={`${celda} text-center`}>
                      {editable && (
                        <button onClick={() => setAEliminar(r)} title="Quitar material" className="text-[#8A9A8C] hover:text-red-600 transition-colors">✕</button>
                      )}
                    </td>
                  </tr>
              ))}
              {renglones.length === 0 && !cargando && (
                <tr>
                  <td colSpan={fechas.length + 4} className="py-6 text-center text-xs text-[#8A9A8C]">
                    Hoja vacía{editable ? ' — agrega el primer material.' : '.'}
                  </td>
                </tr>
              )}
              {cargando && (
                <tr><td colSpan={fechas.length + 4} className="py-6 text-center text-xs text-[#8A9A8C]">Cargando hoja…</td></tr>
              )}
            </tbody>
            {fechas.length > 0 && (
              <tfoot className="border-t-2 border-[#E2E5E2]">
                <tr className="bg-[#F8FAF8]">
                  <td className={`${celda} text-[10px] font-semibold text-[#6B716C] sticky left-0 bg-[#F8FAF8] z-10`}>
                    Total del día
                  </td>
                  {fechas.map(f => (
                    <td key={f.fecha} className={`${celda} text-right font-mono font-bold text-[#1A1A1A]`}>
                      {totalDia(f.fecha).toLocaleString()}
                    </td>
                  ))}
                  <td className={celda} colSpan={3} />
                </tr>
                <tr>
                  <td className={`${celda} text-[10px] text-[#6B716C] sticky left-0 bg-white z-10`}>
                    Nombre y firma de quien entrega
                  </td>
                  {fechas.map(f => (
                    <td key={f.fecha} className={celda}>
                      <input disabled={!editable} className={`${inp} text-center`} value={f.entrega}
                        placeholder="—" onChange={e => setFirma(f.fecha, 'entrega', e.target.value)} />
                    </td>
                  ))}
                  <td className={celda} colSpan={3} />
                </tr>
                <tr>
                  <td className={`${celda} text-[10px] text-[#6B716C] sticky left-0 bg-white z-10`}>
                    Nombre y firma de quien recibe
                  </td>
                  {fechas.map(f => (
                    <td key={f.fecha} className={celda}>
                      <input disabled={!editable} className={`${inp} text-center`} value={f.recibe}
                        placeholder="—" onChange={e => setFirma(f.fecha, 'recibe', e.target.value)} />
                    </td>
                  ))}
                  <td className={celda} colSpan={3} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {editable && (
          <div className="px-3 py-2.5 border-t border-[#E8EFE9] flex items-center gap-2 flex-wrap">
            <button
              onClick={agregarRenglon}
              className="text-xs font-semibold text-white bg-brand-green hover:bg-brand-green-dark rounded-lg px-4 py-2 transition-colors"
            >
              + Agregar material
            </button>

          </div>
        )}
      </div>

      {/* Avance por operaciones: el 100 % son todos los renglones terminados */}
      {renglones.length > 0 && (
        <div className="bg-white border border-[#E2E5E2] rounded-xl shadow-card p-4">
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <h3 className="text-xs font-semibold text-[#1A1A1A] uppercase tracking-wide">
              Operaciones terminadas · {AREA_LABELS.small} y {AREA_LABELS.tips}
            </h3>
            <span className="text-xs font-mono font-bold text-[#1A1A1A]">
              {opsListas} de {renglones.length} ({opsPct}%)
            </span>
          </div>
          <div className="h-2 bg-[#E8EFE9] rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${opsPct >= 100 ? 'bg-brand-green' : 'bg-brand-orange'}`}
              style={{ width: `${opsPct}%` }}
            />
          </div>
          <p className="text-[10px] text-[#8A9A8C] mt-2">
            El avance de estas áreas se mide por las operaciones de esta hoja: marca la casilla
            <span className="font-semibold"> Terminado</span> de cada renglón al completarlo.
          </p>
        </div>
      )}

      <ConfirmModal
        open={!!aEliminar}
        onClose={() => setAEliminar(null)}
        onConfirm={eliminarRenglon}
        titulo="Quitar material"
        variante="peligro"
        confirmarTexto="Quitar"
        cargando={ocupado}
      >
        ¿Quitar el renglón <span className="font-semibold text-[#1A1A1A]">{aEliminar?.descripcion || '(sin descripción)'}</span> y
        sus piezas capturadas? El avance se recalculará.
      </ConfirmModal>

      <ConfirmModal
        open={!!fechaAEliminar}
        onClose={() => setFechaAEliminar(null)}
        onConfirm={eliminarFecha}
        titulo="Quitar fecha"
        variante="peligro"
        confirmarTexto="Quitar"
        cargando={ocupado}
      >
        ¿Quitar la columna del <span className="font-semibold text-[#1A1A1A]">{fechaAEliminar && fechaCorta(fechaAEliminar)}</span>?
        Se borrarán las piezas capturadas ese día y el avance se recalculará.
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
