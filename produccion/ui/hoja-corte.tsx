'use client';

// ─────────────────────────────────────────────────────────────────────────────
//  HOJA DE CORTE — verificación de material (captura oficial del área de corte).
//
//  Réplica digital de la hoja física: un renglón por corrida de corte. Cada día
//  es una "hoja" (como el papel); se navega entre días. Los totales por
//  elemento alimentan automáticamente el avance de Corte y la bitácora del
//  calendario — el supervisor captura UNA sola vez.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useProduccion } from '@/produccion/produccion-store';
import { useSession, puedeCapturar } from '@/autenticacion/auth';
import { coincideElementoHoja, type ComponenteProduccion } from '@/produccion/produccion';
import NumeroInput from '@/compartido/ui/NumeroInput';
import { ConfirmModal } from '@/compartido/ui/Modal';

interface Renglon {
  id: number;
  fecha: string; // YYYY-MM-DD
  operador: string;
  maquina: string;
  hora: string;
  rollo: string;
  elemento: string;
  medidaSpec: string;
  medidaReal: string;
  materialSpec: string;
  materialReal: string;
  laminado: boolean;
  diamSpec: string;
  diamReal: string;
  piezas: number;
  firma: string;
  pc: boolean;
}

function hoyLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function horaAhora(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function fechaBonita(f: string): string {
  return new Date(`${f}T12:00:00`).toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' });
}

const celda = 'px-1.5 py-1 border-r border-[#E8EFE9] last:border-r-0';
const inp =
  'w-full px-1.5 py-1 text-xs border border-transparent rounded bg-transparent hover:border-[#E2E5E2] focus:bg-white focus:border-brand-green focus:outline-none focus:ring-1 focus:ring-brand-green/30 transition-colors disabled:hover:border-transparent';

export default function HojaCortePage() {
  const { ordenes, estados, avances, ready, setAvancesOrden, patchOrden } = useProduccion();
  const { sesion } = useSession();
  const router = useRouter();

  // La orden viene FIJA por la URL (?orden=): se entra a la hoja de UNA orden
  // desde el área de Corte o desde el detalle; aquí no se puede cambiar.
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
  const editable = !!orden && puedeCapturar(sesion, 'corte') && !bloqueo;

  // Componentes del avance de Corte (para metas y como respaldo de nombres).
  const corteComps = useMemo(
    () => (orden ? (avances[orden.id]?.find(a => a.area === 'corte')?.componentes ?? []) : []),
    [avances, orden],
  );

  // ── Elementos de ESTA orden ─────────────────────────────────────────────────
  // El selector "Elemento" ofrece los elementos capturados al crear la orden
  // (explosión de materiales): nombres correctos (Cintas, Cordeles, Válvula de
  // carga…) y sus medidas. "2do Corte" se conserva de la hoja física.
  const opcionesElemento = useMemo(() => {
    const deExplosion = (orden?.corte_elementos ?? []).map(e => e.nombre.trim()).filter(Boolean);
    const base = deExplosion.length > 0 ? deExplosion : corteComps.map(c => c.nombre);
    return [...new Set([...base, '2do Corte'])];
  }, [orden?.corte_elementos, corteComps]);

  // Medida de especificación del elemento (ancho x largo de la explosión).
  const medidaDe = useCallback((nombre: string): string => {
    const el = (orden?.corte_elementos ?? []).find(e => e.nombre === nombre);
    if (!el || !(el.ancho > 0) || !(el.largo > 0)) return '';
    return `${el.ancho} x ${el.largo}${el.unidad === 'cm' ? ' cm' : ''}`;
  }, [orden?.corte_elementos]);

  // ── Renglones (persistidos) ─────────────────────────────────────────────────
  const [renglones, setRenglones] = useState<Renglon[]>([]);
  const [cargando, setCargando] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [avisoCierre, setAvisoCierre] = useState(false);
  const [aEliminar, setAEliminar] = useState<Renglon | null>(null);
  const [eliminando, setEliminando] = useState(false);

  const headers = useCallback(
    () => ({ 'Content-Type': 'application/json', 'x-user-email': sesion?.email ?? '' }),
    [sesion?.email],
  );

  useEffect(() => {
    if (!orden?.id || !sesion?.email) return;
    let cancelado = false;
    setCargando(true);
    fetch(`/api/hoja-corte?orden=${encodeURIComponent(orden.id)}`, { headers: { 'x-user-email': sesion.email } })
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (!cancelado && data?.renglones) setRenglones(data.renglones as Renglon[]);
      })
      .catch(() => {})
      .finally(() => { if (!cancelado) setCargando(false); });
    return () => { cancelado = true; };
  }, [orden?.id, sesion?.email]);

  // Refleja en el store el avance de Corte re-sincronizado por el servidor y,
  // si con esta captura la orden se completó, su cierre automático.
  const aplicarRespuesta = useCallback((data: {
    corte?: ComponenteProduccion[];
    ordenTerminada?: boolean;
    fechaFin?: string | null;
  }) => {
    if (!orden) return;
    if (Array.isArray(data.corte)) {
      const actuales = avances[orden.id] ?? [];
      setAvancesOrden(
        orden.id,
        actuales.map(a =>
          a.area === 'corte'
            ? { ...a, componentes: data.corte!, ultimoReporte: { fecha: new Date().toISOString(), usuario: sesion?.nombre ?? null } }
            : a,
        ),
      );
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
    return [...s].sort().reverse(); // recientes primero
  }, [renglones]);
  const delDia = useMemo(
    () => renglones.filter(r => r.fecha === diaSel).sort((a, b) => a.id - b.id),
    [renglones, diaSel],
  );

  // ── Acciones ────────────────────────────────────────────────────────────────
  async function crearRenglon(base?: Partial<Renglon>) {
    if (!orden) return;
    setMsg(null);
    // Renglón nuevo: arranca con el primer elemento de la orden y su medida de
    // especificación (de la explosión). El duplicado ("nuevo rollo") trae lo suyo.
    const primer = opcionesElemento[0] ?? '';
    const semilla = base ?? { elemento: primer, medidaSpec: medidaDe(primer) };
    try {
      const res = await fetch('/api/hoja-corte', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          orden_id: orden.id,
          fecha: diaSel,
          hora: horaAhora(),
          ...semilla,
          rollo: base ? '' : undefined,   // "nuevo rollo": limpia rollo y piezas
          piezas: 0,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(data?.error ?? 'No se pudo agregar el renglón.');
        return;
      }
      setRenglones(prev => [...prev, data.renglon as Renglon]);
      aplicarRespuesta(data);
    } catch {
      setMsg('No se pudo conectar con el servidor.');
    }
  }

  // "Continuar con rollo nuevo": clona operador/máquina/elemento/medidas/material.
  function nuevoRollo(r: Renglon) {
    crearRenglon({
      operador: r.operador, maquina: r.maquina, elemento: r.elemento,
      medidaSpec: r.medidaSpec, medidaReal: r.medidaReal,
      materialSpec: r.materialSpec, materialReal: r.materialReal,
      laminado: r.laminado, diamSpec: r.diamSpec, diamReal: r.diamReal,
      firma: r.firma,
    });
  }

  // Edición con guardado debounced (0.8 s tras el último cambio del renglón).
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  function actualizarCampos(id: number, patch: Partial<Renglon>) {
    setRenglones(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)));
    const previo = timers.current.get(id);
    if (previo) clearTimeout(previo);
    timers.current.set(id, setTimeout(() => {
      timers.current.delete(id);
      // Toma el estado más reciente del renglón al momento de guardar.
      setRenglones(prev => {
        const r = prev.find(x => x.id === id);
        if (r) {
          fetch(`/api/hoja-corte/${id}`, {
            method: 'PUT',
            headers: headers(),
            body: JSON.stringify(r),
            keepalive: true,
          })
            .then(res => res.json().catch(() => ({})).then(data => {
              if (!res.ok) setMsg(data?.error ?? 'No se pudo guardar el renglón.');
              else aplicarRespuesta(data);
            }))
            .catch(() => setMsg('No se pudo conectar con el servidor.'));
        }
        return prev;
      });
    }, 800));
  }

  function actualizar(id: number, campo: keyof Renglon, valor: string | number | boolean) {
    actualizarCampos(id, { [campo]: valor } as Partial<Renglon>);
  }

  // Al cambiar el elemento, la medida de ESPECIFICACIÓN se llena sola desde la
  // explosión de la orden (la REAL la teclea el operador).
  function cambiarElemento(id: number, elemento: string) {
    const spec = medidaDe(elemento);
    actualizarCampos(id, { elemento, ...(spec ? { medidaSpec: spec } : {}) });
  }

  async function eliminar() {
    if (!aEliminar) return;
    setEliminando(true);
    try {
      const res = await fetch(`/api/hoja-corte/${aEliminar.id}`, { method: 'DELETE', headers: headers() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(data?.error ?? 'No se pudo eliminar.');
        return;
      }
      setRenglones(prev => prev.filter(r => r.id !== aEliminar.id));
      aplicarRespuesta(data);
    } finally {
      setEliminando(false);
      setAEliminar(null);
    }
  }

  // ── Totales ────────────────────────────────────────────────────────────────
  const totalesDia = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of delDia) if (r.piezas > 0) m.set(r.elemento, (m.get(r.elemento) ?? 0) + r.piezas);
    return [...m.entries()];
  }, [delDia]);

  // Acumulado de la orden (todas las hojas) contra la meta del avance de Corte.
  const acumulado = useMemo(() => {
    const porElemento = new Map<string, number>();
    for (const r of renglones) if (r.piezas > 0) porElemento.set(r.elemento, (porElemento.get(r.elemento) ?? 0) + r.piezas);
    return corteComps.map(c => {
      let total = 0;
      for (const [el, n] of porElemento) if (coincideElementoHoja(c.nombre, el)) total += n;
      return { nombre: c.nombre, meta: c.meta, total };
    });
  }, [renglones, corteComps]);

  // Corte COMPLETO: todas las metas cumplidas — el área queda terminada para
  // esta orden. (El exceso por elemento se señala en las barras del acumulado.)
  const corteCompleto = useMemo(
    () => acumulado.length > 0 && acumulado.every(a => a.meta <= 0 || a.total >= a.meta),
    [acumulado],
  );

  if (!ready || !paramListo) return <div className="p-6 text-sm text-[#6B716C]">Cargando…</div>;

  // Sin orden en la URL (o ya no existe): se elige desde el área de Corte.
  if (!orden) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="bg-white border border-[#E2E5E2] rounded-xl p-8 text-center shadow-card">
          <p className="text-sm text-[#6B716C] mb-4">
            Esta hoja pertenece a una orden específica. Elige la orden desde el área de Corte.
          </p>
          <Link
            href="/produccion/corte"
            className="inline-flex text-sm font-semibold text-white bg-brand-green hover:bg-brand-green-dark rounded-lg px-4 py-2 transition-colors"
          >
            Ir al área de Corte
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
        <h1 className="text-xl lg:text-2xl font-semibold text-[#1A1A1A]">Hoja de corte — verificación de material</h1>

      </div>

      {bloqueo && (
        <div className="bg-[#FFF7E8] border border-[#E8C88A] rounded-xl px-4 py-3 text-xs text-[#6B5418]">
          <span className="font-semibold">Solo consulta.</span> {bloqueo}
        </div>
      )}
      {!bloqueo && !puedeCapturar(sesion, 'corte') && (
        <div className="bg-[#FFF7E8] border border-[#E8C88A] rounded-xl px-4 py-3 text-xs text-[#6B5418]">
          <span className="font-semibold">Solo consulta.</span> La hoja la captura el supervisor de Corte o el administrador.
        </div>
      )}
      {msg && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-[#1A1A1A]">{msg}</div>
      )}

      {/* La orden se cerró sola: todas las áreas llegaron al 100 % */}
      {avisoCierre && (
        <div className="bg-brand-green-light border border-brand-green rounded-xl px-4 py-3 text-xs text-[#1A1A1A]">
          <span className="font-bold text-[#047150]">Orden TERMINADA.</span>{' '}
          Todas las áreas alcanzaron el 100 %, así que la orden se cerró automáticamente con la
          fecha y hora de este momento. Un administrador puede reabrirla si hace falta.
        </div>
      )}

      {/* Todas las metas cumplidas: el corte de esta orden está terminado */}
      {corteCompleto && !avisoCierre && (
        <div className="bg-brand-green-50 border border-brand-green/40 rounded-xl px-4 py-3 text-xs text-[#1A1A1A]">
          <span className="font-bold text-[#047150]">Corte completado.</span>{' '}
          Todos los elementos alcanzaron su meta — el área de Corte queda terminada para esta orden
          y el pendiente pasa a las siguientes áreas.
        </div>
      )}

      {/* Encabezado de la hoja */}
      <div className="bg-white border border-[#E2E5E2] rounded-xl shadow-card p-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-[#8A9A8C] mb-1">Supervisor</div>
            <div className="font-semibold text-[#1A1A1A]">{sesion?.nombre ?? '—'}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-[#8A9A8C] mb-1"># Orden de trabajo</div>
            {/* Fija: la hoja pertenece a UNA orden; para otra, entra desde Corte. */}
            <div className="font-bold text-[#1A1A1A] font-mono text-sm">{orden?.numero_orden ?? '—'}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-[#8A9A8C] mb-1">Cliente</div>
            <div className="font-semibold text-[#1A1A1A]">{orden?.cliente ?? '—'}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-[#8A9A8C] mb-1">Sacos de la orden</div>
            <div className="font-semibold text-[#1A1A1A] font-mono">{orden ? orden.cantidad.toLocaleString() : '—'}</div>
          </div>
        </div>

        {/* Hojas por día */}
        <div className="mt-3 pt-3 border-t border-[#F0F5F0] flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] uppercase tracking-wide text-[#8A9A8C] mr-1">Hojas:</span>
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

      {/* La tabla de la hoja del día */}
      <div className="bg-white border border-[#E2E5E2] rounded-xl shadow-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1220px] text-xs border-collapse">
            <thead>
              <tr className="bg-[#F8FAF8] text-[9px] uppercase tracking-wide text-[#8A9A8C] border-b border-[#E2E5E2]">
                <th className={`${celda} text-left font-medium w-32`} rowSpan={2}>Operador</th>
                <th className={`${celda} font-medium w-12`} rowSpan={2}># Máq.</th>
                <th className={`${celda} font-medium w-16`} rowSpan={2}>Hora</th>
                <th className={`${celda} font-medium w-32`} rowSpan={2}># de Rollo</th>
                <th className={`${celda} font-medium w-28`} rowSpan={2}>Elemento</th>
                <th className={`${celda} font-medium`} colSpan={2}>Medidas</th>
                <th className={`${celda} font-medium`} colSpan={2}>Material</th>
                <th className={`${celda} font-medium w-12`} rowSpan={2}>Lam. ✓</th>
                <th className={`${celda} font-medium`} colSpan={2}>Diámetro</th>
                <th className={`${celda} font-medium w-20`} rowSpan={2}>Piezas cortadas</th>
                <th className={`${celda} font-medium w-16`} rowSpan={2}>Firma</th>
                <th className={`${celda} font-medium w-10`} rowSpan={2}>PC ✓</th>
                <th className={`${celda} w-20`} rowSpan={2} />
              </tr>
              <tr className="bg-[#F8FAF8] text-[9px] uppercase tracking-wide text-[#8A9A8C] border-b border-[#E2E5E2]">
                <th className={`${celda} font-medium w-24`}>Especif.</th>
                <th className={`${celda} font-medium w-24`}>Real</th>
                <th className={`${celda} font-medium w-16`}>Especif.</th>
                <th className={`${celda} font-medium w-16`}>Real</th>
                <th className={`${celda} font-medium w-16`}>Especif.</th>
                <th className={`${celda} font-medium w-16`}>Real</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0F5F0]">
              {delDia.map(r => (
                <tr key={r.id} className="hover:bg-[#FBFCFB]">
                  <td className={celda}>
                    <input disabled={!editable} className={inp} value={r.operador} placeholder="Nombre" onChange={e => actualizar(r.id, 'operador', e.target.value)} />
                  </td>
                  <td className={celda}>
                    <input disabled={!editable} className={`${inp} text-center font-mono`} value={r.maquina} placeholder="#" onChange={e => actualizar(r.id, 'maquina', e.target.value)} />
                  </td>
                  <td className={celda}>
                    <input disabled={!editable} type="time" className={`${inp} font-mono`} value={r.hora} onChange={e => actualizar(r.id, 'hora', e.target.value)} />
                  </td>
                  <td className={celda}>
                    <input disabled={!editable} className={`${inp} font-mono`} value={r.rollo} placeholder="N/A" onChange={e => actualizar(r.id, 'rollo', e.target.value)} />
                  </td>
                  <td className={celda}>
                    <select disabled={!editable} className={`${inp} cursor-pointer`} value={r.elemento} onChange={e => cambiarElemento(r.id, e.target.value)}>
                      {(opcionesElemento.includes(r.elemento) || !r.elemento
                        ? opcionesElemento
                        : [r.elemento, ...opcionesElemento]
                      ).map(el => <option key={el} value={el}>{el}</option>)}
                    </select>
                  </td>
                  <td className={celda}>
                    <input disabled={!editable} className={`${inp} font-mono`} value={r.medidaSpec} placeholder="42 x 59" onChange={e => actualizar(r.id, 'medidaSpec', e.target.value)} />
                  </td>
                  <td className={celda}>
                    <input disabled={!editable} className={`${inp} font-mono ${r.medidaReal && r.medidaReal !== r.medidaSpec ? 'text-red-600 font-semibold' : ''}`} value={r.medidaReal} placeholder="ancho x largo" onChange={e => actualizar(r.id, 'medidaReal', e.target.value)} />
                  </td>
                  <td className={celda}>
                    <input disabled={!editable} className={`${inp} font-mono`} value={r.materialSpec} placeholder="6CW" onChange={e => actualizar(r.id, 'materialSpec', e.target.value)} />
                  </td>
                  <td className={celda}>
                    <input disabled={!editable} className={`${inp} font-mono ${r.materialReal && r.materialReal !== r.materialSpec ? 'text-red-600 font-semibold' : ''}`} value={r.materialReal} placeholder="6CW" onChange={e => actualizar(r.id, 'materialReal', e.target.value)} />
                  </td>
                  <td className={`${celda} text-center`}>
                    <input disabled={!editable} type="checkbox" checked={r.laminado} onChange={e => actualizar(r.id, 'laminado', e.target.checked)} className="accent-[#009166] w-4 h-4 cursor-pointer" />
                  </td>
                  <td className={celda}>
                    <input disabled={!editable} className={`${inp} font-mono`} value={r.diamSpec} placeholder="N/A" onChange={e => actualizar(r.id, 'diamSpec', e.target.value)} />
                  </td>
                  <td className={celda}>
                    <input disabled={!editable} className={`${inp} font-mono ${r.diamReal && r.diamReal !== r.diamSpec ? 'text-red-600 font-semibold' : ''}`} value={r.diamReal} placeholder="N/A" onChange={e => actualizar(r.id, 'diamReal', e.target.value)} />
                  </td>
                  <td className={celda}>
                    <NumeroInput disabled={!editable} valor={r.piezas} onValor={v => actualizar(r.id, 'piezas', parseInt(v, 10) || 0)} className={`${inp} text-right font-mono font-semibold`} />
                  </td>
                  <td className={celda}>
                    <input disabled={!editable} className={`${inp} text-center`} value={r.firma} placeholder="Inic." onChange={e => actualizar(r.id, 'firma', e.target.value)} />
                  </td>
                  <td className={`${celda} text-center`}>
                    <input disabled={!editable} type="checkbox" checked={r.pc} onChange={e => actualizar(r.id, 'pc', e.target.checked)} className="accent-[#009166] w-4 h-4 cursor-pointer" />
                  </td>
                  <td className={`${celda} text-center whitespace-nowrap`}>
                    {editable && (
                      <>
                        <button
                          onClick={() => nuevoRollo(r)}
                          title="Continuar con rollo nuevo (copia operador, máquina, elemento y medidas)"
                          className="text-[10px] font-medium text-[#1A6B4A] border border-brand-green/30 hover:bg-brand-green-50 rounded px-1.5 py-0.5 transition-colors"
                        >
                          +Rollo
                        </button>
                        <button onClick={() => setAEliminar(r)} title="Eliminar renglón" className="ml-1.5 text-[#8A9A8C] hover:text-red-600 transition-colors">✕</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {delDia.length === 0 && !cargando && (
                <tr><td colSpan={16} className="py-6 text-center text-xs text-[#8A9A8C]">
                  Hoja del {fechaBonita(diaSel)} sin renglones{editable ? ' — agrega la primera corrida.' : '.'}
                </td></tr>
              )}
              {cargando && (
                <tr><td colSpan={16} className="py-6 text-center text-xs text-[#8A9A8C]">Cargando hoja…</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-3 py-2.5 border-t border-[#E8EFE9] flex items-center justify-between flex-wrap gap-2">
          {editable ? (
            <button
              onClick={() => crearRenglon()}
              className="text-xs font-semibold text-white bg-brand-green hover:bg-brand-green-dark rounded-lg px-4 py-2 transition-colors"
            >
              + Agregar renglón
            </button>
          ) : <span />}
          <span className="text-[10px] text-[#8A9A8C]">
            +Rollo: continúa la misma operación con un rollo nuevo · PC: verificación de contaminación
            (metal, cartón, hilos o madera) · En rojo: el REAL no coincide con la especificación.
          </span>
        </div>
      </div>

      {/* Totales del día */}
      <div className="bg-white border border-[#E2E5E2] rounded-xl shadow-card p-4">
        <h2 className="text-xs font-semibold text-[#1A1A1A] uppercase tracking-wide mb-2">
          Piezas de esta hoja ({diaSel === hoyLocal() ? 'hoy' : fechaBonita(diaSel)})
        </h2>
        {totalesDia.length === 0 ? (
          <p className="text-xs text-[#8A9A8C]">Aún sin piezas capturadas en esta hoja.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {totalesDia.map(([el, n]) => (
              <span key={el} className="text-xs bg-[#F6F8F1] border border-[#E2E5E2] rounded-lg px-3 py-1.5">
                {el}: <span className="font-mono font-bold text-[#1A1A1A]">{n.toLocaleString()}</span>
              </span>
            ))}
          </div>
        )}

        {/* Acumulado de la orden vs meta */}
        {acumulado.length > 0 && (
          <div className="mt-4 pt-3 border-t border-[#F0F5F0]">
            <h3 className="text-xs font-semibold text-[#1A1A1A] uppercase tracking-wide mb-2">
              Acumulado de la orden (todas las hojas)
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {acumulado.map(a => {
                const excede = a.meta > 0 && a.total > a.meta;
                const pct = a.meta > 0 ? Math.min(100, Math.round((a.total / a.meta) * 100)) : 0;
                const color = excede ? 'bg-red-500' : pct >= 100 ? 'bg-brand-green' : 'bg-brand-orange';
                return (
                  <div key={a.nombre} className="text-xs">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[#6B716C]">{a.nombre}</span>
                      <span className={`font-mono font-semibold ${excede ? 'text-red-600' : 'text-[#1A1A1A]'}`}>
                        {a.total.toLocaleString()} / {a.meta.toLocaleString()}
                        {excede && <span className="font-bold"> (+{(a.total - a.meta).toLocaleString()})</span>}
                      </span>
                    </div>
                    <div className="h-1.5 bg-[#E8EFE9] rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Confirmación de borrado */}
      <ConfirmModal
        open={!!aEliminar}
        onClose={() => setAEliminar(null)}
        onConfirm={eliminar}
        titulo="Eliminar renglón"
        variante="peligro"
        confirmarTexto="Eliminar"
        cargando={eliminando}
      >
        ¿Eliminar el renglón de <span className="font-semibold text-[#1A1A1A]">{aEliminar?.operador || 'sin operador'}</span>{' '}
        ({aEliminar?.elemento}, {aEliminar?.piezas.toLocaleString()} pzas)? El avance de Corte se recalculará.
      </ConfirmModal>
    </div>
  );
}
