'use client';

// ─────────────────────────────────────────────────────────────────────────────
//  CONTROL DE MESAS DE CALIDAD — captura oficial del área de Calidad.
//
//  Réplica de la hoja física (PRO-FOR-015): cada hoja es un día/turno con 4
//  mesas de 2 personas. En el papel cada mesa va tachando la retícula de 1 a 175
//  conforme infla y revisa sacos; aquí se cuenta saco por saco con el botón "+"
//  y la retícula se tacha sola (el número no se escribe a mano, para que el
//  conteo sea siempre el de los sacos que de verdad pasaron por la mesa).
//
//  El avance del área son los sacos revisados —la suma de las mesas activas de
//  TODAS las hojas— contra los sacos de la orden, así que entregar varias hojas
//  no altera el cálculo.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useProduccion } from '@/produccion/produccion-store';
import BotonImprimir from '@/produccion/ui/BotonImprimir';
import { useSession } from '@/autenticacion/auth';
import { AREA_LABELS } from '@/compartido/mock-data';
import type { AvanceArea } from '@/produccion/produccion';
import { ConfirmModal } from '@/compartido/ui/Modal';
import PestanasHoja, { pestanasCalidad, PESTANA_MESAS } from '@/produccion/ui/PestanasHoja';
import ReticulaConteo from '@/produccion/ui/ReticulaConteo';

// La retícula del papel: 175 casillas por mesa en 7 columnas de 25.
const MAX_MESA = 175;
const FILAS = 25;
const COLUMNAS = 7;
const MESAS = [1, 2, 3, 4];

// Una mesa la trabajan DOS personas: sin las dos no se puede activar, y sin
// activar no se captura ni suma al avance.
interface Mesa { op1: string; op2: string; activa: boolean; total: number }
const MESA_VACIA: Mesa = { op1: '', op2: '', activa: false, total: 0 };
const mesaCompleta = (m: Mesa) => m.op1.trim() !== '' && m.op2.trim() !== '';
interface HojaCalidad {
  id: number;
  fecha: string;
  turno: string;
  supervisor: string;
  observaciones: string;
  mesas: Mesa[];
}

function hoyLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fechaBonita(f: string): string {
  return new Date(`${f}T12:00:00`).toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' });
}

const inp =
  'w-full px-2 py-1 text-xs border border-[#E2E5E2] rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-brand-green focus:border-brand-green transition-colors disabled:bg-[#F8FAF8] disabled:text-[#6B716C]';

export default function HojaCalidadPage() {
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
  const puede = sesion?.rol === 'admin' || (sesion?.rol === 'supervisor' && sesion.area_asignada === 'calidad');
  const editable = !!orden && !!puede && !bloqueo;

  const [hojas, setHojas] = useState<HojaCalidad[]>([]);
  const [cargando, setCargando] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [avisoCierre, setAvisoCierre] = useState(false);
  const [aEliminar, setAEliminar] = useState<HojaCalidad | null>(null);
  const [eliminando, setEliminando] = useState(false);

  const headers = useCallback(
    () => ({ 'Content-Type': 'application/json' }),
    [],
  );

  useEffect(() => {
    if (!orden?.id || !sesion?.email) return;
    let cancelado = false;
    setCargando(true);
    fetch(`/api/hoja-calidad?orden=${encodeURIComponent(orden.id)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (cancelado || !data) return;
        setHojas(data.hojas as HojaCalidad[]);
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
    const s = new Set<string>(hojas.map(h => h.fecha));
    s.add(hoyLocal());
    return [...s].sort().reverse();
  }, [hojas]);
  const delDia = useMemo(
    () => hojas.filter(h => h.fecha === diaSel).sort((a, b) => a.id - b.id),
    [hojas, diaSel],
  );

  // ── Acciones ────────────────────────────────────────────────────────────────
  async function agregarHoja() {
    if (!orden) return;
    setMsg(null);
    const res = await fetch('/api/hoja-calidad', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ orden_id: orden.id, fecha: diaSel }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setMsg(data?.error ?? 'No se pudo abrir la hoja.'); return; }
    setHojas(prev => [...prev, data.hoja as HojaCalidad]);
    aplicarRespuesta(data);
  }

  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  function guardar(id: number) {
    const previo = timers.current.get(id);
    if (previo) clearTimeout(previo);
    timers.current.set(id, setTimeout(() => {
      timers.current.delete(id);
      setHojas(prev => {
        const h = prev.find(x => x.id === id);
        if (h) {
          fetch(`/api/hoja-calidad/${id}`, {
            method: 'PUT',
            headers: headers(),
            body: JSON.stringify(h),
            keepalive: true,
          })
            .then(res => res.json().catch(() => ({})).then(data => {
              if (!res.ok) { setMsg(data?.error ?? 'No se pudo guardar la hoja.'); return; }
              aplicarRespuesta(data);
            }))
            .catch(() => setMsg('No se pudo conectar con el servidor.'));
        }
        return prev;
      });
    }, 800));
  }

  function actualizar(id: number, campo: 'turno' | 'supervisor' | 'observaciones', valor: string) {
    setHojas(prev => prev.map(h => (h.id === id ? { ...h, [campo]: valor } : h)));
    guardar(id);
  }

  function actualizarMesa(id: number, idx: number, cambio: Partial<Mesa>) {
    setHojas(prev => prev.map(h => (
      h.id === id
        ? {
            ...h,
            mesas: h.mesas.map((m, i) => {
              if (i !== idx) return m;
              const nueva = { ...m, ...cambio };
              // Si se borra a alguno de los dos operadores, la mesa se desactiva.
              return mesaCompleta(nueva) ? nueva : { ...nueva, activa: false };
            }),
          }
        : h
    )));
    guardar(id);
  }

  async function eliminar() {
    if (!aEliminar) return;
    setEliminando(true);
    try {
      const res = await fetch(`/api/hoja-calidad/${aEliminar.id}`, { method: 'DELETE', headers: headers() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg(data?.error ?? 'No se pudo eliminar.'); return; }
      setHojas(prev => prev.filter(h => h.id !== aEliminar.id));
      aplicarRespuesta(data);
    } finally {
      setEliminando(false);
      setAEliminar(null);
    }
  }

  // ── Totales ─────────────────────────────────────────────────────────────────
  // Solo cuentan las mesas activas (las que tienen a sus dos operadores).
  const granTotal = (h: HojaCalidad) => h.mesas.reduce((s, m) => s + (m.activa ? m.total : 0), 0);
  const revisados = hojas.reduce((s, h) => s + granTotal(h), 0);
  const meta = orden?.cantidad ?? 0;
  const pct = meta > 0 ? Math.min(100, Math.round((revisados / meta) * 100)) : 0;
  const faltan = Math.max(0, meta - revisados);

  if (!ready || !paramListo) return <div className="p-6 text-sm text-[#6B716C]">Cargando…</div>;

  if (!orden) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="bg-white border border-[#E2E5E2] rounded-xl p-8 text-center shadow-card">
          <p className="text-sm text-[#6B716C] mb-4">
            Esta hoja pertenece a una orden específica. Elige la orden desde Calidad.
          </p>
          <Link
            href="/produccion/calidad"
            className="inline-flex text-sm font-semibold text-white bg-brand-green hover:bg-brand-green-dark rounded-lg px-4 py-2 transition-colors"
          >
            Ir al área de Calidad
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
        <h1 className="text-xl lg:text-2xl font-semibold text-[#1A1A1A]">Control de mesas de calidad</h1>
        <p className="text-sm text-[#6B716C]">
          Hoja de {AREA_LABELS.calidad}: los sacos que llegan de {AREA_LABELS.tapa} se inflan y se
          revisan en las mesas. Cuenta con el botón <span className="font-semibold">+</span> de cada
          mesa y la retícula se va tachando sola, igual que en el papel.
        </p>
        <BotonImprimir orden={orden.id} hoja="calidad" permitido={puede} />
      </div>

      <PestanasHoja pestanas={pestanasCalidad(orden.id)} activa={PESTANA_MESAS} />

      {bloqueo && (
        <div className="bg-[#FFF7E8] border border-[#E8C88A] rounded-xl px-4 py-3 text-xs text-[#6B5418]">
          <span className="font-semibold">Solo consulta.</span> {bloqueo}
        </div>
      )}
      {!bloqueo && !puede && (
        <div className="bg-[#FFF7E8] border border-[#E8C88A] rounded-xl px-4 py-3 text-xs text-[#6B5418]">
          <span className="font-semibold">Solo consulta.</span> La hoja la captura el supervisor de {AREA_LABELS.calidad} (o el administrador).
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
          <Dato label="Orden" valor={orden.numero_orden} mono />
          <Dato label="Cliente" valor={orden.cliente} />
          <Dato label="Cantidad" valor={`${orden.cantidad.toLocaleString()} sacos`} mono />
          <Dato label="Estilo del saco" valor={orden.tipo_saco} />
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

      {/* Hojas del día */}
      {cargando ? (
        <div className="bg-white border border-[#E2E5E2] rounded-xl shadow-card py-8 text-center text-xs text-[#8A9A8C]">
          Cargando hojas…
        </div>
      ) : delDia.length === 0 ? (
        <div className="bg-white border border-[#E2E5E2] rounded-xl shadow-card py-8 text-center text-xs text-[#8A9A8C]">
          Sin hojas del {fechaBonita(diaSel)}{editable ? ' — abre la primera.' : '.'}
        </div>
      ) : (
        delDia.map((h, i) => (
          <HojaMesas
            key={h.id}
            hoja={h}
            numero={i + 1}
            editable={editable}
            onCampo={(campo, valor) => actualizar(h.id, campo, valor)}
            onMesa={(idx, cambio) => actualizarMesa(h.id, idx, cambio)}
            onEliminar={() => setAEliminar(h)}
          />
        ))
      )}

      {editable && (
        <button
          onClick={agregarHoja}
          className="text-xs font-semibold text-white bg-brand-green hover:bg-brand-green-dark rounded-lg px-4 py-2 transition-colors"
        >
          + Agregar hoja de mesas
        </button>
      )}

      {/* Avance del área */}
      <div className="bg-white border border-[#E2E5E2] rounded-xl shadow-card p-4">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <h3 className="text-xs font-semibold text-[#1A1A1A] uppercase tracking-wide">
            Avance de {AREA_LABELS.calidad}
          </h3>
          <span className="text-xs font-mono text-[#6B716C]">
            <span className="font-bold text-[#1A1A1A]">{revisados.toLocaleString()}</span>
            {' '}/ {meta.toLocaleString()} sacos ({pct}%)
          </span>
        </div>
        <div className="h-2.5 bg-[#E8EFE9] rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${pct >= 100 ? 'bg-brand-green' : 'bg-brand-orange'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="text-[10px] text-[#8A9A8C] mt-3">
          {pct >= 100
            ? 'Todos los sacos de la orden pasaron por las mesas: el área está al 100 %.'
            : `Faltan ${faltan.toLocaleString()} sacos por revisar.`}
          {' '}Se suman las mesas activas de todas las hojas ({hojas.length} {hojas.length === 1 ? 'hoja' : 'hojas'}),
          así que entregar varias hojas por orden no altera el avance.
        </p>
      </div>

      <ConfirmModal
        open={!!aEliminar}
        onClose={() => setAEliminar(null)}
        onConfirm={eliminar}
        titulo="Eliminar hoja de mesas"
        variante="peligro"
        confirmarTexto="Eliminar"
        cargando={eliminando}
      >
        ¿Eliminar esta hoja del {aEliminar ? fechaBonita(aEliminar.fecha) : ''}
        {aEliminar?.turno ? <> (turno {aEliminar.turno})</> : null}? Se descontarán sus{' '}
        <span className="font-semibold text-[#1A1A1A]">
          {aEliminar ? granTotal(aEliminar).toLocaleString() : 0}
        </span>{' '}
        sacos del avance.
      </ConfirmModal>
    </div>
  );
}

// ─── Una hoja física: 4 mesas + turno, supervisor y observaciones ──────────────

function HojaMesas({
  hoja, numero, editable, onCampo, onMesa, onEliminar,
}: {
  hoja: HojaCalidad;
  numero: number;
  editable: boolean;
  onCampo: (campo: 'turno' | 'supervisor' | 'observaciones', valor: string) => void;
  onMesa: (idx: number, cambio: Partial<Mesa>) => void;
  onEliminar: () => void;
}) {
  const granTotal = hoja.mesas.reduce((s, m) => s + (m.activa ? m.total : 0), 0);

  return (
    <div className="bg-white border border-[#E2E5E2] rounded-xl shadow-card overflow-hidden">
      {/* Encabezado de la hoja */}
      <div className="flex items-center justify-between gap-3 flex-wrap px-4 py-3 bg-[#F8FAF8] border-b border-[#E2E5E2]">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs font-bold text-[#1A1A1A]">Hoja {numero}</span>
          <label className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wide text-[#8A9A8C]">Turno</span>
            <input
              disabled={!editable}
              className={`${inp} w-16 text-center`}
              value={hoja.turno}
              placeholder="1°"
              onChange={e => onCampo('turno', e.target.value)}
            />
          </label>
          <label className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wide text-[#8A9A8C]">Supervisor</span>
            <input
              disabled={!editable}
              className={`${inp} w-44`}
              value={hoja.supervisor}
              placeholder="Nombre"
              onChange={e => onCampo('supervisor', e.target.value)}
            />
          </label>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wide text-[#8A9A8C]">Gran total mesas</div>
            <div className="text-base font-bold font-mono text-[#1A1A1A] leading-none">
              {granTotal.toLocaleString()}
            </div>
          </div>
          {editable && (
            <button onClick={onEliminar} title="Eliminar hoja" className="text-[#8A9A8C] hover:text-red-600 transition-colors">✕</button>
          )}
        </div>
      </div>

      {/* Las 4 mesas */}
      <div className="p-3 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {MESAS.map((n, idx) => (
          <MesaCard
            key={n}
            numero={n}
            mesa={hoja.mesas[idx] ?? MESA_VACIA}
            editable={editable}
            onCambio={cambio => onMesa(idx, cambio)}
          />
        ))}
      </div>

      {/* Observaciones */}
      <div className="px-3 pb-3">
        <label className="block">
          <span className="text-[10px] uppercase tracking-wide text-[#8A9A8C]">Observaciones</span>
          <input
            disabled={!editable}
            className={`${inp} mt-1`}
            value={hoja.observaciones}
            placeholder="—"
            onChange={e => onCampo('observaciones', e.target.value)}
          />
        </label>
      </div>
    </div>
  );
}

// ─── Una mesa: 2 personas y la retícula de 1 a 175 ─────────────────────────────

function MesaCard({
  numero, mesa, editable, onCambio,
}: {
  numero: number;
  mesa: Mesa;
  editable: boolean;
  onCambio: (cambio: Partial<Mesa>) => void;
}) {
  const limitar = (v: number) => Math.max(0, Math.min(MAX_MESA, v));
  const completa = mesaCompleta(mesa);
  // Sin los dos operadores la mesa no se activa, y sin activar no se captura.
  const capturable = editable && mesa.activa;

  return (
    <div className={`border rounded-lg overflow-hidden transition-colors ${
      mesa.activa ? 'border-brand-green/40' : 'border-[#E2E5E2]'
    }`}>
      <div className={`px-2.5 py-2 border-b border-[#E2E5E2] ${mesa.activa ? 'bg-brand-green-light' : 'bg-[#F0F5F0]'}`}>
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wide text-[#6B716C]">Mesa #{numero}</span>
          <label
            className={`flex items-center gap-1.5 ${editable && completa ? 'cursor-pointer' : 'cursor-not-allowed'}`}
            title={completa ? 'Activar la mesa' : 'Registra a las 2 personas de la mesa'}
          >
            <input
              type="checkbox"
              disabled={!editable || !completa}
              checked={mesa.activa}
              onChange={e => onCambio({ activa: e.target.checked })}
              className="accent-[#009166] w-3.5 h-3.5 disabled:opacity-40"
            />
            <span className={`text-[10px] font-semibold ${mesa.activa ? 'text-[#047150]' : 'text-[#8A9A8C]'}`}>
              {mesa.activa ? 'Activa' : 'Inactiva'}
            </span>
          </label>
        </div>
        <div className="space-y-1">
          <input
            disabled={!editable}
            className={inp}
            value={mesa.op1}
            placeholder="Operador 1"
            onChange={e => onCambio({ op1: e.target.value })}
          />
          <input
            disabled={!editable}
            className={inp}
            value={mesa.op2}
            placeholder="Operador 2"
            onChange={e => onCambio({ op2: e.target.value })}
          />
        </div>
      </div>

      {/* Aviso de la regla: 2 personas por mesa */}
      {!mesa.activa && (
        <div className="px-2.5 py-2 bg-[#FFF7E8] border-b border-[#E8C88A] text-[10px] text-[#6B5418]">
          {completa
            ? 'Marca la casilla para activar la mesa y empezar a contar.'
            : 'Faltan operadores: la mesa se trabaja entre 2 personas. Sin las dos no se puede activar ni sumar.'}
        </div>
      )}

      {/* Retícula 1–175 (7 columnas de 25, como el papel) */}
      <ReticulaConteo
        total={mesa.total}
        max={MAX_MESA}
        filas={FILAS}
        columnas={COLUMNAS}
        atenuada={!mesa.activa}
      />

      {/* Total de la mesa */}
      <div className="flex items-center justify-between gap-2 px-2.5 py-2 border-t border-[#E8EFE9] bg-[#F8FAF8]">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[#6B716C]">
          Total mesa #{numero}
        </span>
        {/* El conteo solo se mueve con estos botones: "+" suma un saco (y "−"
            corrige si se pasó). Ni la retícula ni el número se editan a mano. */}
        <div className="flex items-center gap-1">
          {capturable && (
            <button
              onClick={() => onCambio({ total: limitar(mesa.total - 1) })}
              disabled={mesa.total <= 0}
              title="Quitar un saco (corrección)"
              className="w-6 h-6 rounded border border-[#E2E5E2] text-[#6B716C] hover:bg-white flex items-center justify-center text-xs font-bold disabled:opacity-40"
            >−</button>
          )}
          <span
            className={`w-14 px-1.5 py-1 text-xs text-center font-mono font-bold tabular-nums ${
              mesa.activa ? 'text-[#1A1A1A]' : 'text-[#8A9A8C]'
            }`}
          >
            {mesa.total}
          </span>
          {capturable && (
            <button
              onClick={() => onCambio({ total: limitar(mesa.total + 1) })}
              disabled={mesa.total >= MAX_MESA}
              title="Sumar un saco revisado"
              className="w-7 h-7 rounded-md bg-brand-green text-white hover:bg-brand-green-dark flex items-center justify-center text-sm font-bold transition-colors disabled:opacity-40"
            >+</button>
          )}
        </div>
      </div>
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
