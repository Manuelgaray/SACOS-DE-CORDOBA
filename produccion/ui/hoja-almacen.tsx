'use client';

// ─────────────────────────────────────────────────────────────────────────────
//  FORMATO DE SALIDA Y ENTREGA DE MATERIALES A PRODUCCIÓN — captura de Almacén.
//
//  Réplica de la hoja física (ALM-FOR-001): cada ENTREGA cubre cierta cantidad
//  de sacos de la orden y lista los materiales que salieron, con su etiqueta,
//  factura, tag, cantidad y unidad. Las filas sombreadas del papel son el total
//  por familia de material (marcadas aquí como "resumen").
//
//  La devolución esperada NO se captura: es cantidad entregada − consumo
//  esperado, y se calcula sola para que nunca haya una resta mal hecha.
//
//  El avance del área son los sacos cuyo material ya salió al piso.
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
import { agruparMateriales, familiaDeMaterial } from '@/produccion/almacen-familia';

// Unidades que usa la planta en este formato.
const UNIDADES = ['YD', 'MT', 'PZ', 'KG', 'LB'];

interface MaterialAlm {
  id: number;
  hoja_id: number;
  material: string;
  etiqueta: string;
  factura: string;
  tag: string;
  cantidad: number;
  unidad: string;
}

interface ConsumoAlm {
  familia: string;
  consumo_esperado: number;
  devolucion_real: number;
}

interface EntregaAlm {
  id: number;
  fecha: string;
  cantidad_entregada: number;
  firma_entrega: string;
  firma_recepcion_corte: string;
  firma_recepcion_prod: string;
  firma_recepcion_alm: string;
  firma_entrega_corte: string;
  materiales: MaterialAlm[];
  consumos: ConsumoAlm[];
}

function hoyLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fechaBonita(f: string): string {
  return new Date(`${f}T12:00:00`).toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' });
}

// La devolución esperada siempre es lo entregado menos lo que se va a consumir.
const devolucionEsperada = (entregado: number, consumo: number) => Math.max(0, entregado - consumo);
const numFmt = (n: number) => (n ? n.toLocaleString('es-MX', { maximumFractionDigits: 2 }) : '');

const celda = 'px-2 py-1 border-r border-[#E8EFE9] last:border-r-0';
const inp =
  'w-full px-1.5 py-1 text-xs border border-transparent rounded bg-transparent hover:border-[#E2E5E2] focus:bg-white focus:border-brand-green focus:outline-none focus:ring-1 focus:ring-brand-green/30 transition-colors disabled:hover:border-transparent';
const inpCampo =
  'px-2 py-1 text-xs border border-[#E2E5E2] rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-brand-green focus:border-brand-green transition-colors disabled:bg-[#F8FAF8] disabled:text-[#6B716C]';

export default function HojaAlmacenPage() {
  const { ordenes, estados, avances, ready, setAvancesOrden, patchOrden } = useProduccion();
  const { sesion } = useSession();
  const router = useRouter();

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
  const puede = sesion?.rol === 'admin' || (sesion?.rol === 'supervisor' && sesion.area_asignada === 'almacen');
  const editable = !!orden && !!puede && !bloqueo;

  const [entregas, setEntregas] = useState<EntregaAlm[]>([]);
  const [cargando, setCargando] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [avisoCierre, setAvisoCierre] = useState(false);
  const [aEliminar, setAEliminar] = useState<EntregaAlm | null>(null);
  const [eliminando, setEliminando] = useState(false);

  const headers = useCallback(
    () => ({ 'Content-Type': 'application/json' }),
    [],
  );

  useEffect(() => {
    if (!orden?.id || !sesion?.email) return;
    let cancelado = false;
    setCargando(true);
    fetch(`/api/hoja-almacen?orden=${encodeURIComponent(orden.id)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => { if (!cancelado && data) setEntregas(data.hojas as EntregaAlm[]); })
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

  // ── Entregas por día ────────────────────────────────────────────────────────
  const [diaSel, setDiaSel] = useState(hoyLocal());
  const dias = useMemo(() => {
    const s = new Set<string>(entregas.map(e => e.fecha));
    s.add(hoyLocal());
    return [...s].sort().reverse();
  }, [entregas]);
  const delDia = useMemo(
    () => entregas.filter(e => e.fecha === diaSel).sort((a, b) => a.id - b.id),
    [entregas, diaSel],
  );

  // ── Acciones ────────────────────────────────────────────────────────────────
  async function agregarEntrega() {
    if (!orden) return;
    setMsg(null);
    const res = await fetch('/api/hoja-almacen', {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ orden_id: orden.id, fecha: diaSel }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setMsg(data?.error ?? 'No se pudo abrir la entrega.'); return; }
    setEntregas(prev => [...prev, data.hoja as EntregaAlm]);
    aplicarRespuesta(data);
  }

  const timersHoja = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  function guardarHoja(id: number) {
    const previo = timersHoja.current.get(id);
    if (previo) clearTimeout(previo);
    timersHoja.current.set(id, setTimeout(() => {
      timersHoja.current.delete(id);
      setEntregas(prev => {
        const h = prev.find(x => x.id === id);
        if (h) {
          fetch(`/api/hoja-almacen/${id}`, {
            method: 'PUT', headers: headers(), body: JSON.stringify(h), keepalive: true,
          })
            .then(res => res.json().catch(() => ({})).then(data => {
              if (!res.ok) { setMsg(data?.error ?? 'No se pudo guardar la entrega.'); return; }
              aplicarRespuesta(data);
            }))
            .catch(() => setMsg('No se pudo conectar con el servidor.'));
        }
        return prev;
      });
    }, 800));
  }

  function actualizarHoja(id: number, cambio: Partial<EntregaAlm>) {
    setEntregas(prev => prev.map(h => (h.id === id ? { ...h, ...cambio } : h)));
    guardarHoja(id);
  }

  const timersMat = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  function guardarMaterial(hojaId: number, matId: number) {
    const previo = timersMat.current.get(matId);
    if (previo) clearTimeout(previo);
    timersMat.current.set(matId, setTimeout(() => {
      timersMat.current.delete(matId);
      setEntregas(prev => {
        const m = prev.find(h => h.id === hojaId)?.materiales.find(x => x.id === matId);
        if (m) {
          fetch(`/api/hoja-almacen/material/${matId}`, {
            method: 'PUT', headers: headers(), body: JSON.stringify(m), keepalive: true,
          })
            .then(res => { if (!res.ok) res.json().catch(() => ({})).then(d => setMsg(d?.error ?? 'No se pudo guardar el material.')); })
            .catch(() => setMsg('No se pudo conectar con el servidor.'));
        }
        return prev;
      });
    }, 800));
  }

  function actualizarMaterial(hojaId: number, matId: number, cambio: Partial<MaterialAlm>) {
    setEntregas(prev => prev.map(h => (h.id === hojaId
      ? { ...h, materiales: h.materiales.map(m => (m.id === matId ? { ...m, ...cambio } : m)) }
      : h)));
    guardarMaterial(hojaId, matId);
  }

  async function agregarMaterial(hojaId: number) {
    setMsg(null);
    const res = await fetch('/api/hoja-almacen/material', {
      method: 'POST', headers: headers(), body: JSON.stringify({ hoja_id: hojaId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setMsg(data?.error ?? 'No se pudo agregar el material.'); return; }
    setEntregas(prev => prev.map(h => (h.id === hojaId
      ? { ...h, materiales: [...h.materiales, data.material as MaterialAlm] }
      : h)));
  }

  // Consumo y devolución van por FAMILIA, no por rollo.
  const timersCons = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  function actualizarConsumo(hojaId: number, familia: string, cambio: Partial<ConsumoAlm>) {
    setEntregas(prev => prev.map(h => {
      if (h.id !== hojaId) return h;
      const existe = h.consumos.some(c => c.familia === familia);
      const consumos = existe
        ? h.consumos.map(c => (c.familia === familia ? { ...c, ...cambio } : c))
        : [...h.consumos, { familia, consumo_esperado: 0, devolucion_real: 0, ...cambio }];
      return { ...h, consumos };
    }));

    const clave = `${hojaId}|${familia}`;
    const previo = timersCons.current.get(clave);
    if (previo) clearTimeout(previo);
    timersCons.current.set(clave, setTimeout(() => {
      timersCons.current.delete(clave);
      setEntregas(prev => {
        const c = prev.find(h => h.id === hojaId)?.consumos.find(x => x.familia === familia);
        if (c) {
          fetch(`/api/hoja-almacen/${hojaId}/consumo`, {
            method: 'PUT', headers: headers(), body: JSON.stringify(c), keepalive: true,
          })
            .then(res => { if (!res.ok) res.json().catch(() => ({})).then(d => setMsg(d?.error ?? 'No se pudo guardar el consumo.')); })
            .catch(() => setMsg('No se pudo conectar con el servidor.'));
        }
        return prev;
      });
    }, 800));
  }

  async function quitarMaterial(hojaId: number, matId: number) {
    setEntregas(prev => prev.map(h => (h.id === hojaId
      ? { ...h, materiales: h.materiales.filter(m => m.id !== matId) }
      : h)));
    await fetch(`/api/hoja-almacen/material/${matId}`, { method: 'DELETE', headers: headers() })
      .catch(() => setMsg('No se pudo conectar con el servidor.'));
  }

  async function eliminarEntrega() {
    if (!aEliminar) return;
    setEliminando(true);
    try {
      const res = await fetch(`/api/hoja-almacen/${aEliminar.id}`, { method: 'DELETE', headers: headers() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg(data?.error ?? 'No se pudo eliminar.'); return; }
      setEntregas(prev => prev.filter(h => h.id !== aEliminar.id));
      aplicarRespuesta(data);
    } finally {
      setEliminando(false);
      setAEliminar(null);
    }
  }

  // ── Totales ─────────────────────────────────────────────────────────────────
  const entregado = entregas.reduce((s, h) => s + h.cantidad_entregada, 0);
  const meta = orden?.cantidad ?? 0;
  const restante = Math.max(0, meta - entregado);
  const pct = meta > 0 ? Math.min(100, Math.round((entregado / meta) * 100)) : 0;

  if (!ready || !paramListo) return <div className="p-6 text-sm text-[#6B716C]">Cargando…</div>;

  if (!orden) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="bg-white border border-[#E2E5E2] rounded-xl p-8 text-center shadow-card">
          <p className="text-sm text-[#6B716C] mb-4">
            Esta hoja pertenece a una orden específica. Elige la orden desde Almacén.
          </p>
          <Link href="/produccion/almacen" className="inline-flex text-sm font-semibold text-white bg-brand-green hover:bg-brand-green-dark rounded-lg px-4 py-2 transition-colors">
            Ir al área de Almacén
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
        <h1 className="text-xl lg:text-2xl font-semibold text-[#1A1A1A]">
          Salida y entrega de materiales a producción
        </h1>
        <p className="text-sm text-[#6B716C]">
          Hoja de {AREA_LABELS.almacen}: cada entrega anota los sacos que cubre y los materiales que
          salieron al piso. La devolución esperada se calcula sola.
        </p>
        <BotonImprimir orden={orden.id} hoja="almacen" permitido={puede} />
      </div>

      {bloqueo && (
        <div className="bg-[#FFF7E8] border border-[#E8C88A] rounded-xl px-4 py-3 text-xs text-[#6B5418]">
          <span className="font-semibold">Solo consulta.</span> {bloqueo}
        </div>
      )}
      {!bloqueo && !puede && (
        <div className="bg-[#FFF7E8] border border-[#E8C88A] rounded-xl px-4 py-3 text-xs text-[#6B5418]">
          <span className="font-semibold">Solo consulta.</span> La hoja la captura el supervisor de {AREA_LABELS.almacen} (o el administrador).
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
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
          <Dato label="Orden" valor={orden.numero_orden} mono />
          <Dato label="Cliente" valor={orden.cliente} />
          <Dato label="Cantidad total" valor={orden.cantidad.toLocaleString()} mono />
          <Dato label="Cantidad real entregada" valor={entregado.toLocaleString()} mono />
          <Dato label="Cantidad restante" valor={restante.toLocaleString()} mono />
        </div>

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

      {/* Entregas del día */}
      {cargando ? (
        <div className="bg-white border border-[#E2E5E2] rounded-xl shadow-card py-8 text-center text-xs text-[#8A9A8C]">
          Cargando entregas…
        </div>
      ) : delDia.length === 0 ? (
        <div className="bg-white border border-[#E2E5E2] rounded-xl shadow-card py-8 text-center text-xs text-[#8A9A8C]">
          Sin entregas del {fechaBonita(diaSel)}{editable ? ' — abre la primera.' : '.'}
        </div>
      ) : (
        delDia.map((h, i) => (
          <TarjetaEntrega
            key={h.id}
            entrega={h}
            numero={i + 1}
            editable={editable}
            onCampo={(cambio) => actualizarHoja(h.id, cambio)}
            onMaterial={(matId, cambio) => actualizarMaterial(h.id, matId, cambio)}
            onConsumo={(familia, cambio) => actualizarConsumo(h.id, familia, cambio)}
            onAgregarMaterial={() => agregarMaterial(h.id)}
            onQuitarMaterial={(matId) => quitarMaterial(h.id, matId)}
            onEliminar={() => setAEliminar(h)}
          />
        ))
      )}

      {editable && (
        <button
          onClick={agregarEntrega}
          className="text-xs font-semibold text-white bg-brand-green hover:bg-brand-green-dark rounded-lg px-4 py-2 transition-colors"
        >
          + Nueva entrega de materiales
        </button>
      )}

      {/* Avance del área */}
      <div className="bg-white border border-[#E2E5E2] rounded-xl shadow-card p-4">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <h3 className="text-xs font-semibold text-[#1A1A1A] uppercase tracking-wide">
            Avance de {AREA_LABELS.almacen}
          </h3>
          <span className="text-xs font-mono text-[#6B716C]">
            <span className="font-bold text-[#1A1A1A]">{entregado.toLocaleString()}</span>
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
            ? 'Todo el material de la orden salió a producción: el área está al 100 %.'
            : `Faltan ${restante.toLocaleString()} sacos por surtir.`}
          {' '}Se suman las {entregas.length} {entregas.length === 1 ? 'entrega' : 'entregas'} de la orden.
        </p>
      </div>

      <ConfirmModal
        open={!!aEliminar}
        onClose={() => setAEliminar(null)}
        onConfirm={eliminarEntrega}
        titulo="Eliminar entrega"
        variante="peligro"
        confirmarTexto="Eliminar"
        cargando={eliminando}
      >
        ¿Eliminar esta entrega del {aEliminar ? fechaBonita(aEliminar.fecha) : ''}? Se borrarán sus{' '}
        <span className="font-semibold text-[#1A1A1A]">{aEliminar?.materiales.length ?? 0} renglones</span>{' '}
        de material y se descontarán sus{' '}
        <span className="font-semibold text-[#1A1A1A]">{(aEliminar?.cantidad_entregada ?? 0).toLocaleString()}</span> sacos del avance.
      </ConfirmModal>
    </div>
  );
}

// ─── Una entrega: encabezado, materiales y firmas ─────────────────────────────

function TarjetaEntrega({
  entrega, numero, editable, onCampo, onMaterial, onConsumo, onAgregarMaterial, onQuitarMaterial, onEliminar,
}: {
  entrega: EntregaAlm;
  numero: number;
  editable: boolean;
  onCampo: (cambio: Partial<EntregaAlm>) => void;
  onMaterial: (matId: number, cambio: Partial<MaterialAlm>) => void;
  onConsumo: (familia: string, cambio: Partial<ConsumoAlm>) => void;
  onAgregarMaterial: () => void;
  onQuitarMaterial: (matId: number) => void;
  onEliminar: () => void;
}) {
  // Los renglones sombreados salen solos: se agrupan por la clave que viene
  // dentro del código del rollo y su cantidad es la suma de sus rollos.
  const grupos = useMemo(() => agruparMateriales(entrega.materiales), [entrega.materiales]);
  const consumoDe = (familia: string) =>
    entrega.consumos.find(c => c.familia === familia) ?? { familia, consumo_esperado: 0, devolucion_real: 0 };

  // Renglón que aún no tiene código: se captura suelto, sin familia todavía.
  let indice = 0;

  return (
    <div className="bg-white border border-[#E2E5E2] rounded-xl shadow-card overflow-hidden">
      <div className="flex items-center justify-between gap-3 flex-wrap px-4 py-3 bg-[#F8FAF8] border-b border-[#E2E5E2]">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs font-bold text-[#1A1A1A]">Entrega {numero}</span>
          <label className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wide text-[#8A9A8C]">Sacos que cubre</span>
            <NumeroInput
              disabled={!editable}
              valor={entrega.cantidad_entregada}
              onValor={v => onCampo({ cantidad_entregada: Math.max(0, parseInt(v, 10) || 0) })}
              className={`${inpCampo} w-24 text-right font-mono font-bold`}
            />
          </label>
        </div>
        {editable && (
          <button onClick={onEliminar} title="Eliminar entrega" className="text-[#8A9A8C] hover:text-red-600 transition-colors">✕</button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] text-xs border-collapse">
          <thead>
            <tr className="bg-[#F8FAF8] text-[9px] uppercase tracking-wide text-[#8A9A8C] border-b border-[#E2E5E2]">
              <th className={`${celda} w-8`}>#</th>
              <th className={`${celda} text-left font-medium w-44`}>Material</th>
              <th className={`${celda} font-medium w-36`}>No. etiqueta</th>
              <th className={`${celda} font-medium w-24`}>Factura</th>
              <th className={`${celda} font-medium w-24`}>Tag</th>
              <th className={`${celda} font-medium w-24`}>Cant. entregada</th>
              <th className={`${celda} font-medium w-16`}>Unidad</th>
              <th className={`${celda} font-medium w-24`}>Consumo esperado</th>
              <th className={`${celda} font-medium w-24 bg-[#F0F5F0]`}>Devolución esperada</th>
              <th className={`${celda} font-medium w-24`}>Devolución real</th>
              <th className={`${celda} w-8`} />
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F0F5F0]">
            {grupos.map(g => {
              const cons = consumoDe(g.clave);
              // El renglón sombreado solo aparece cuando el código trae familia
              // de tela; cintas, etiquetas y accesorios van en su propia fila.
              const filas = [];

              if (g.esFamilia) {
                indice += 1;
                filas.push(
                  <tr key={`f-${g.clave}`} className="bg-[#E8EFE9]">
                    <td className={`${celda} text-center text-[10px] text-[#6B716C]`}>{indice}</td>
                    <td className={`${celda} font-bold text-[#1A1A1A]`}>{g.clave}</td>
                    <td className={`${celda} text-center text-[#8A9A8C]`}>———</td>
                    <td className={`${celda} text-center text-[#8A9A8C]`}>———</td>
                    <td className={`${celda} text-center text-[#8A9A8C]`}>———</td>
                    {/* Suma de sus rollos: no se teclea. */}
                    <td className={`${celda} text-right font-mono font-bold text-[#1A1A1A]`}>
                      {numFmt(g.total)}
                    </td>
                    <td className={`${celda} text-center text-[#8A9A8C]`}>———</td>
                    <td className={celda}>
                      <NumeroInput disabled={!editable} valor={cons.consumo_esperado} step="0.01"
                        onValor={v => onConsumo(g.clave, { consumo_esperado: Math.max(0, parseFloat(v) || 0) })}
                        className={`${inp} text-right font-mono`} />
                    </td>
                    <td className={`${celda} text-right font-mono font-bold text-[#1A1A1A] bg-[#DDE7DE]`}>
                      {cons.consumo_esperado > 0 ? numFmt(devolucionEsperada(g.total, cons.consumo_esperado)) : ''}
                    </td>
                    <td className={celda}>
                      <NumeroInput disabled={!editable} valor={cons.devolucion_real} step="0.01"
                        onValor={v => onConsumo(g.clave, { devolucion_real: Math.max(0, parseFloat(v) || 0) })}
                        className={`${inp} text-right font-mono`} />
                    </td>
                    <td className={celda} />
                  </tr>,
                );
              }

              for (const m of g.renglones) {
                indice += 1;
                const suelto = !g.esFamilia;
                filas.push(
                  <tr key={m.id} className="hover:bg-[#FBFCFB]">
                    <td className={`${celda} text-center text-[10px] text-[#8A9A8C]`}>{indice}</td>
                    <td className={celda}>
                      <input disabled={!editable} className={inp} value={m.material}
                        placeholder="Ej. SCFLF6CW48RAF" title={familiaDeMaterial(m.material) ? `Familia ${familiaDeMaterial(m.material)}` : 'Sin familia de tela'}
                        onChange={e => onMaterial(m.id, { material: e.target.value.toUpperCase() })} />
                    </td>
                    <td className={celda}>
                      <input disabled={!editable} className={`${inp} text-center font-mono`} value={m.etiqueta}
                        onChange={e => onMaterial(m.id, { etiqueta: e.target.value })} />
                    </td>
                    <td className={celda}>
                      <input disabled={!editable} className={`${inp} text-center font-mono`} value={m.factura}
                        onChange={e => onMaterial(m.id, { factura: e.target.value })} />
                    </td>
                    <td className={celda}>
                      <input disabled={!editable} className={`${inp} text-center font-mono`} value={m.tag}
                        onChange={e => onMaterial(m.id, { tag: e.target.value })} />
                    </td>
                    <td className={celda}>
                      <NumeroInput disabled={!editable} valor={m.cantidad} step="0.01"
                        onValor={v => onMaterial(m.id, { cantidad: Math.max(0, parseFloat(v) || 0) })}
                        className={`${inp} text-right font-mono`} />
                    </td>
                    <td className={celda}>
                      <input disabled={!editable} list="unidades-almacen" className={`${inp} text-center`}
                        value={m.unidad} onChange={e => onMaterial(m.id, { unidad: e.target.value.toUpperCase() })} />
                    </td>
                    {/* En los rollos de una familia estas tres columnas van en
                        blanco: el consumo se anota arriba, en el sombreado. */}
                    {suelto ? (
                      <>
                        <td className={celda}>
                          <NumeroInput disabled={!editable} valor={cons.consumo_esperado} step="0.01"
                            onValor={v => onConsumo(g.clave, { consumo_esperado: Math.max(0, parseFloat(v) || 0) })}
                            className={`${inp} text-right font-mono`} />
                        </td>
                        <td className={`${celda} text-right font-mono font-bold text-[#1A1A1A] bg-[#F8FAF8]`}>
                          {cons.consumo_esperado > 0 ? numFmt(devolucionEsperada(g.total, cons.consumo_esperado)) : ''}
                        </td>
                        <td className={celda}>
                          <NumeroInput disabled={!editable} valor={cons.devolucion_real} step="0.01"
                            onValor={v => onConsumo(g.clave, { devolucion_real: Math.max(0, parseFloat(v) || 0) })}
                            className={`${inp} text-right font-mono`} />
                        </td>
                      </>
                    ) : (
                      <>
                        <td className={celda} /><td className={`${celda} bg-[#F8FAF8]`} /><td className={celda} />
                      </>
                    )}
                    <td className={`${celda} text-center`}>
                      {editable && (
                        <button onClick={() => onQuitarMaterial(m.id)} title="Quitar renglón"
                          className="text-[#8A9A8C] hover:text-red-600 transition-colors">✕</button>
                      )}
                    </td>
                  </tr>,
                );
              }
              return filas;
            })}
            {entrega.materiales.length === 0 && (
              <tr><td colSpan={11} className="py-6 text-center text-xs text-[#8A9A8C]">
                Sin materiales{editable ? ' — agrega el primero.' : '.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {editable && (
        <div className="px-3 py-2.5 border-t border-[#E8EFE9] flex flex-wrap items-center gap-3">
          <button onClick={onAgregarMaterial}
            className="text-xs font-semibold text-white bg-brand-green hover:bg-brand-green-dark rounded-lg px-4 py-2 transition-colors">
            + Agregar rollo o material
          </button>
          <span className="text-[10px] text-[#8A9A8C]">
            El renglón sombreado de cada familia aparece solo, con la suma de sus rollos.
          </span>
        </div>
      )}

      {/* Firmas del formato */}
      <div className="px-3 pb-3 pt-1 grid grid-cols-1 sm:grid-cols-3 xl:grid-cols-5 gap-2">
        {([
          ['firma_entrega', 'Entrega almacén'],
          ['firma_recepcion_corte', 'Recepción corte'],
          ['firma_recepcion_prod', 'Recepción producción'],
          ['firma_recepcion_alm', 'Recepción almacén'],
          ['firma_entrega_corte', 'Entrega corte'],
        ] as const).map(([campo, etiqueta]) => (
          <label key={campo} className="block">
            <span className="text-[10px] uppercase tracking-wide text-[#8A9A8C]">{etiqueta}</span>
            <input disabled={!editable} className={`${inpCampo} w-full mt-1`} value={entrega[campo]}
              placeholder="Nombre" onChange={e => onCampo({ [campo]: e.target.value } as Partial<EntregaAlm>)} />
          </label>
        ))}
      </div>

      <datalist id="unidades-almacen">
        {UNIDADES.map(u => <option key={u} value={u} />)}
      </datalist>
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
