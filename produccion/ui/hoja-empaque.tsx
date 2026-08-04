'use client';

// ─────────────────────────────────────────────────────────────────────────────
//  CONTROL DE TARIMAS Y SACOS EN PRENSA — captura oficial del área de Empaque.
//
//  Réplica de la hoja física (PRO-FOR-007): la hoja agrupa 5 tarimas, y cada
//  tarima lleva su fecha, su número consecutivo, la retícula de 1 a 200 que se
//  va tachando conforme entran los sacos a la prensa, y el peso en libras.
//
//  El conteo solo sube con el botón "+" (un clic = un saco), igual que en las
//  mesas de calidad. El avance del área es la suma de todas las tarimas contra
//  los sacos de la orden.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useProduccion } from '@/produccion/produccion-store';
import BotonImprimir from '@/produccion/ui/BotonImprimir';
import { useSession } from '@/autenticacion/auth';
import { AREA_LABELS } from '@/compartido/mock-data';
import type { AvanceArea } from '@/produccion/produccion';
import NumeroInput from '@/compartido/ui/NumeroInput';
import { ConfirmModal } from '@/compartido/ui/Modal';
import ReticulaConteo from '@/produccion/ui/ReticulaConteo';

// La retícula del papel: 200 casillas por tarima en 7 columnas de 30 (la última
// columna se queda a medias, igual que en la hoja).
const MAX_TARIMA = 200;
const FILAS = 30;
const COLUMNAS = 7;
// La hoja física agrupa 5 tarimas.
const TARIMAS_POR_HOJA = 5;

// Turnos de la planta (van en el encabezado de la hoja, como en el papel).
const TURNOS = ['1°', '2°'];

interface Tarima {
  id: number;
  numero: number;
  fecha: string;
  turno: string;
  contados: number;
  peso: number;
}

function hoyLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const inp =
  'w-full px-2 py-1 text-xs border border-[#E2E5E2] rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-brand-green focus:border-brand-green transition-colors disabled:bg-[#F8FAF8] disabled:text-[#6B716C]';

export default function HojaEmpaquePage() {
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
  const puede = sesion?.rol === 'admin' || (sesion?.rol === 'supervisor' && sesion.area_asignada === 'empaque');
  const editable = !!orden && !!puede && !bloqueo;

  const [tarimas, setTarimas] = useState<Tarima[]>([]);
  const [cargando, setCargando] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [avisoCierre, setAvisoCierre] = useState(false);
  const [aEliminar, setAEliminar] = useState<Tarima | null>(null);
  const [eliminando, setEliminando] = useState(false);

  const headers = useCallback(
    () => ({ 'Content-Type': 'application/json', 'x-user-email': sesion?.email ?? '' }),
    [sesion?.email],
  );

  useEffect(() => {
    if (!orden?.id || !sesion?.email) return;
    let cancelado = false;
    setCargando(true);
    fetch(`/api/hoja-empaque?orden=${encodeURIComponent(orden.id)}`, { headers: { 'x-user-email': sesion.email } })
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (cancelado || !data) return;
        setTarimas(data.tarimas as Tarima[]);
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

  // ── Hojas de 5 tarimas ──────────────────────────────────────────────────────
  const hojas = useMemo(() => {
    const orden5: Tarima[][] = [];
    const lista = [...tarimas].sort((a, b) => a.numero - b.numero || a.id - b.id);
    for (let i = 0; i < lista.length; i += TARIMAS_POR_HOJA) {
      orden5.push(lista.slice(i, i + TARIMAS_POR_HOJA));
    }
    return orden5;
  }, [tarimas]);

  const [hojaSel, setHojaSel] = useState(0);
  const idxHoja = Math.min(hojaSel, Math.max(0, hojas.length - 1));
  const delaHoja = hojas[idxHoja] ?? [];

  // El turno va en el encabezado (uno por hoja), como en el papel.
  const [turnoNuevo, setTurnoNuevo] = useState('');
  const turnoHoja = delaHoja.length > 0 ? delaHoja[0].turno : turnoNuevo;

  function cambiarTurno(valor: string) {
    setTurnoNuevo(valor);
    if (delaHoja.length === 0) return;
    const ids = new Set(delaHoja.map(t => t.id));
    setTarimas(prev => prev.map(t => (ids.has(t.id) ? { ...t, turno: valor } : t)));
    for (const t of delaHoja) guardar(t.id);
  }

  // ── Acciones ────────────────────────────────────────────────────────────────
  async function agregarTarima() {
    if (!orden) return;
    setMsg(null);
    const res = await fetch('/api/hoja-empaque', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ orden_id: orden.id, fecha: hoyLocal(), turno: turnoHoja }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setMsg(data?.error ?? 'No se pudo abrir la tarima.'); return; }
    setTarimas(prev => [...prev, data.tarima as Tarima]);
    // Saltar a la hoja donde cayó la tarima nueva.
    setHojaSel(Math.floor(tarimas.length / TARIMAS_POR_HOJA));
    aplicarRespuesta(data);
  }

  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  function guardar(id: number) {
    const previo = timers.current.get(id);
    if (previo) clearTimeout(previo);
    timers.current.set(id, setTimeout(() => {
      timers.current.delete(id);
      setTarimas(prev => {
        const t = prev.find(x => x.id === id);
        if (t) {
          fetch(`/api/hoja-empaque/${id}`, {
            method: 'PUT',
            headers: headers(),
            body: JSON.stringify(t),
            keepalive: true,
          })
            .then(res => res.json().catch(() => ({})).then(data => {
              if (!res.ok) { setMsg(data?.error ?? 'No se pudo guardar la tarima.'); return; }
              aplicarRespuesta(data);
            }))
            .catch(() => setMsg('No se pudo conectar con el servidor.'));
        }
        return prev;
      });
    }, 800));
  }

  function actualizar(id: number, cambio: Partial<Tarima>) {
    setTarimas(prev => prev.map(t => (t.id === id ? { ...t, ...cambio } : t)));
    guardar(id);
  }

  async function eliminar() {
    if (!aEliminar) return;
    setEliminando(true);
    try {
      const res = await fetch(`/api/hoja-empaque/${aEliminar.id}`, { method: 'DELETE', headers: headers() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg(data?.error ?? 'No se pudo eliminar.'); return; }
      setTarimas(prev => prev.filter(t => t.id !== aEliminar.id));
      aplicarRespuesta(data);
    } finally {
      setEliminando(false);
      setAEliminar(null);
    }
  }

  // ── Totales ─────────────────────────────────────────────────────────────────
  const empacados = tarimas.reduce((s, t) => s + t.contados, 0);
  const pesoHoja = delaHoja.reduce((s, t) => s + t.peso, 0);
  const meta = orden?.cantidad ?? 0;
  const pct = meta > 0 ? Math.min(100, Math.round((empacados / meta) * 100)) : 0;
  const faltan = Math.max(0, meta - empacados);

  if (!ready || !paramListo) return <div className="p-6 text-sm text-[#6B716C]">Cargando…</div>;

  if (!orden) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="bg-white border border-[#E2E5E2] rounded-xl p-8 text-center shadow-card">
          <p className="text-sm text-[#6B716C] mb-4">
            Esta hoja pertenece a una orden específica. Elige la orden desde Empaque.
          </p>
          <Link
            href="/produccion/empaque"
            className="inline-flex text-sm font-semibold text-white bg-brand-green hover:bg-brand-green-dark rounded-lg px-4 py-2 transition-colors"
          >
            Ir al área de Empaque
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
        <h1 className="text-xl lg:text-2xl font-semibold text-[#1A1A1A]">Control de tarimas y sacos en prensa</h1>
        <p className="text-sm text-[#6B716C]">
          Hoja de {AREA_LABELS.empaque}: los sacos que salen de {AREA_LABELS.calidad} se prensan y se
          arman en tarimas. Cuenta con el botón <span className="font-semibold">+</span> conforme
          entran a la prensa y anota el peso de cada tarima.
        </p>
        <BotonImprimir orden={orden.id} hoja="empaque" permitido={puede} />
      </div>

      {bloqueo && (
        <div className="bg-[#FFF7E8] border border-[#E8C88A] rounded-xl px-4 py-3 text-xs text-[#6B5418]">
          <span className="font-semibold">Solo consulta.</span> {bloqueo}
        </div>
      )}
      {!bloqueo && !puede && (
        <div className="bg-[#FFF7E8] border border-[#E8C88A] rounded-xl px-4 py-3 text-xs text-[#6B5418]">
          <span className="font-semibold">Solo consulta.</span> La hoja la captura el supervisor de {AREA_LABELS.empaque} (o el administrador).
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
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
          <Dato label="Orden" valor={orden.numero_orden} mono />
          <Dato label="Cantidad" valor={`${orden.cantidad.toLocaleString()} sacos`} mono />
          <Dato label="Cliente" valor={orden.cliente} />
          <Dato label="Supervisor" valor={sesion?.nombre ?? '—'} />
          <div>
            <div className="text-[10px] uppercase tracking-wide text-[#8A9A8C] mb-1">Turno</div>
            <select
              disabled={!editable}
              className={`${inp} font-semibold`}
              value={turnoHoja}
              onChange={e => cambiarTurno(e.target.value)}
            >
              <option value="">—</option>
              {TURNOS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        {/* Hojas de 5 tarimas */}
        {hojas.length > 0 && (
          <div className="mt-3 pt-3 border-t border-[#F0F5F0] flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] uppercase tracking-wide text-[#8A9A8C] mr-1">Hoja:</span>
            {hojas.map((h, i) => (
              <button
                key={i}
                onClick={() => setHojaSel(i)}
                className={`text-[11px] rounded-lg px-2.5 py-1 border transition-colors ${
                  i === idxHoja
                    ? 'bg-brand-green text-white border-brand-green font-semibold'
                    : 'border-[#E2E5E2] text-[#6B716C] hover:bg-[#F6F8F1]'
                }`}
              >
                {i + 1} <span className="font-mono">({h[0].numero}–{h[h.length - 1].numero})</span>
              </button>
            ))}
            <span className="ml-auto text-[11px] text-[#6B716C]">
              Peso de la hoja: <span className="font-mono font-bold text-[#1A1A1A]">{pesoHoja.toLocaleString()}</span> lbs
            </span>
          </div>
        )}
      </div>

      {/* Las tarimas de la hoja */}
      {cargando ? (
        <div className="bg-white border border-[#E2E5E2] rounded-xl shadow-card py-8 text-center text-xs text-[#8A9A8C]">
          Cargando tarimas…
        </div>
      ) : delaHoja.length === 0 ? (
        <div className="bg-white border border-[#E2E5E2] rounded-xl shadow-card py-8 text-center text-xs text-[#8A9A8C]">
          Todavía no hay tarimas en esta orden{editable ? ' — abre la primera.' : '.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
          {delaHoja.map(t => (
            <TarimaCard
              key={t.id}
              tarima={t}
              editable={editable}
              onCambio={cambio => actualizar(t.id, cambio)}
              onEliminar={() => setAEliminar(t)}
            />
          ))}
        </div>
      )}

      {editable && (
        <button
          onClick={agregarTarima}
          className="text-xs font-semibold text-white bg-brand-green hover:bg-brand-green-dark rounded-lg px-4 py-2 transition-colors"
        >
          + Agregar tarima
        </button>
      )}

      {/* Avance del área */}
      <div className="bg-white border border-[#E2E5E2] rounded-xl shadow-card p-4">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <h3 className="text-xs font-semibold text-[#1A1A1A] uppercase tracking-wide">
            Avance de {AREA_LABELS.empaque}
          </h3>
          <span className="text-xs font-mono text-[#6B716C]">
            <span className="font-bold text-[#1A1A1A]">{empacados.toLocaleString()}</span>
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
            ? 'Todos los sacos de la orden quedaron prensados en tarimas: el área está al 100 %.'
            : `Faltan ${faltan.toLocaleString()} sacos por prensar.`}
          {' '}Se suman las {tarimas.length} {tarimas.length === 1 ? 'tarima' : 'tarimas'} de la orden,
          sin importar en cuántas hojas se hayan repartido.
        </p>
      </div>

      <ConfirmModal
        open={!!aEliminar}
        onClose={() => setAEliminar(null)}
        onConfirm={eliminar}
        titulo="Eliminar tarima"
        variante="peligro"
        confirmarTexto="Eliminar"
        cargando={eliminando}
      >
        ¿Eliminar la <span className="font-semibold text-[#1A1A1A]">tarima {aEliminar?.numero}</span>?
        Se descontarán sus{' '}
        <span className="font-semibold text-[#1A1A1A]">{(aEliminar?.contados ?? 0).toLocaleString()}</span>{' '}
        sacos del avance.
      </ConfirmModal>
    </div>
  );
}

// ─── Una tarima: fecha, retícula de 1 a 200, peso y su contador ────────────────

function TarimaCard({
  tarima, editable, onCambio, onEliminar,
}: {
  tarima: Tarima;
  editable: boolean;
  onCambio: (cambio: Partial<Tarima>) => void;
  onEliminar: () => void;
}) {
  const limitar = (v: number) => Math.max(0, Math.min(MAX_TARIMA, v));
  const llena = tarima.contados >= MAX_TARIMA;

  return (
    <div className={`border rounded-lg overflow-hidden transition-colors ${
      llena ? 'border-brand-green/40' : 'border-[#E2E5E2]'
    }`}>
      <div className={`px-2.5 py-2 border-b border-[#E2E5E2] ${llena ? 'bg-brand-green-light' : 'bg-[#F0F5F0]'}`}>
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wide text-[#6B716C]">
            Tarima N° <span className="font-mono text-[#1A1A1A]">{tarima.numero}</span>
          </span>
          {editable && (
            <button onClick={onEliminar} title="Eliminar tarima" className="text-[#8A9A8C] hover:text-red-600 transition-colors">✕</button>
          )}
        </div>
        <input
          type="date"
          disabled={!editable}
          className={inp}
          value={tarima.fecha}
          onChange={e => onCambio({ fecha: e.target.value })}
        />
      </div>

      {/* Retícula 1–200 (7 columnas de 30, como el papel) */}
      <ReticulaConteo total={tarima.contados} max={MAX_TARIMA} filas={FILAS} columnas={COLUMNAS} />

      {/* Peso de la tarima */}
      <div className="flex items-center justify-between gap-2 px-2.5 py-2 border-t border-[#E8EFE9]">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[#6B716C]">Peso</span>
        <div className="flex items-center gap-1">
          <NumeroInput
            disabled={!editable}
            valor={tarima.peso}
            onValor={v => onCambio({ peso: Math.max(0, parseInt(v, 10) || 0) })}
            className="w-20 px-1.5 py-1 text-xs text-right font-mono border border-[#E2E5E2] rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-brand-green focus:border-brand-green disabled:bg-[#F8FAF8]"
          />
          <span className="text-[10px] text-[#8A9A8C]">lbs</span>
        </div>
      </div>

      {/* Conteo: solo se mueve con estos botones ("+" suma, "−" corrige) */}
      <div className="flex items-center justify-between gap-2 px-2.5 py-2 border-t border-[#E8EFE9] bg-[#F8FAF8]">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[#6B716C]">Sacos</span>
        <div className="flex items-center gap-1">
          {editable && (
            <button
              onClick={() => onCambio({ contados: limitar(tarima.contados - 1) })}
              disabled={tarima.contados <= 0}
              title="Quitar un saco (corrección)"
              className="w-6 h-6 rounded border border-[#E2E5E2] text-[#6B716C] hover:bg-white flex items-center justify-center text-xs font-bold disabled:opacity-40"
            >−</button>
          )}
          <span className="w-14 px-1.5 py-1 text-xs text-center font-mono font-bold tabular-nums text-[#1A1A1A]">
            {tarima.contados}
          </span>
          {editable && (
            <button
              onClick={() => onCambio({ contados: limitar(tarima.contados + 1) })}
              disabled={llena}
              title={llena ? 'Tarima llena: abre otra' : 'Sumar un saco a la tarima'}
              className="w-7 h-7 rounded-md bg-brand-green text-white hover:bg-brand-green-dark flex items-center justify-center text-sm font-bold transition-colors disabled:opacity-40"
            >+</button>
          )}
        </div>
      </div>

      {llena && (
        <div className="px-2.5 py-1.5 bg-brand-green-light text-[10px] font-semibold text-[#047150] text-center">
          Tarima completa ({MAX_TARIMA} sacos)
        </div>
      )}
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
