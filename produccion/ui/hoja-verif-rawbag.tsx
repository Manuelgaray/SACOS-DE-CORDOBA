'use client';

// ─────────────────────────────────────────────────────────────────────────────
//  VERIFICACIÓN DE ÁREA DE RAW BAG — control de calidad (solo Big).
//
//  Réplica de la hoja física: por cada revisión a un operador se compara la
//  ESPECIFICACIÓN contra lo REAL (medidas del saco, loops, diámetro V.D y
//  material) y se marcan filler, folt y PC. Es solo registro de calidad: no
//  afecta el avance del área. Lo que no coincide se resalta en rojo.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useProduccion } from '@/produccion/produccion-store';
import { useSession } from '@/autenticacion/auth';
import { ConfirmModal } from '@/compartido/ui/Modal';
import PestanasHoja from '@/produccion/ui/PestanasHoja';

interface RenglonVerif {
  id: number;
  fecha: string;
  operador: string;
  hora: string;
  puntadas: string;
  hilos: string;
  medida_spec: string;
  medida_real: string;
  loop_libre_spec: string;
  loop_traslape_spec: string;
  loop_costurado_spec: string;
  loop_color_spec: string;
  loop_libre_real: string;
  loop_traslape_real: string;
  loop_costurado_real: string;
  loop_color_real: string;
  diam_spec: string;
  diam_real: string;
  material_spec: string;
  material_real: string;
  filler1: boolean;
  filler2: boolean;
  folt: boolean;
  pc: boolean;
  observaciones: string;
}

// Pares especificación/real que se comparan para resaltar diferencias.
const PARES: [keyof RenglonVerif, keyof RenglonVerif][] = [
  ['medida_spec', 'medida_real'],
  ['loop_libre_spec', 'loop_libre_real'],
  ['loop_traslape_spec', 'loop_traslape_real'],
  ['loop_costurado_spec', 'loop_costurado_real'],
  ['loop_color_spec', 'loop_color_real'],
  ['diam_spec', 'diam_real'],
  ['material_spec', 'material_real'],
];

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

export default function HojaVerifRawbagPage() {
  const { ordenes, estados, ready } = useProduccion();
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
  const puede = sesion?.rol === 'admin' || (sesion?.rol === 'supervisor' && sesion.area_asignada === 'big');
  const editable = !!orden && !!puede && !bloqueo;

  const [renglones, setRenglones] = useState<RenglonVerif[]>([]);
  const [cargando, setCargando] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [aEliminar, setAEliminar] = useState<RenglonVerif | null>(null);
  const [eliminando, setEliminando] = useState(false);

  const headers = useCallback(
    () => ({ 'Content-Type': 'application/json', 'x-user-email': sesion?.email ?? '' }),
    [sesion?.email],
  );

  useEffect(() => {
    if (!orden?.id || !sesion?.email) return;
    let cancelado = false;
    setCargando(true);
    fetch(`/api/hoja-verif-rawbag?orden=${encodeURIComponent(orden.id)}`, { headers: { 'x-user-email': sesion.email } })
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (!cancelado && data?.renglones) setRenglones(data.renglones as RenglonVerif[]);
      })
      .catch(() => {})
      .finally(() => { if (!cancelado) setCargando(false); });
    return () => { cancelado = true; };
  }, [orden?.id, sesion?.email]);

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
    const res = await fetch('/api/hoja-verif-rawbag', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        orden_id: orden.id,
        fecha: diaSel,
        hora: horaAhora(),
        // La especificación se hereda de la orden; el operador captura lo REAL.
        medida_spec: orden.medida,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setMsg(data?.error ?? 'No se pudo agregar la verificación.'); return; }
    setRenglones(prev => [...prev, data.renglon as RenglonVerif]);
  }

  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  function actualizar(id: number, campo: keyof RenglonVerif, valor: string | boolean) {
    setRenglones(prev => prev.map(r => (r.id === id ? { ...r, [campo]: valor } : r)));
    const previo = timers.current.get(id);
    if (previo) clearTimeout(previo);
    timers.current.set(id, setTimeout(() => {
      timers.current.delete(id);
      setRenglones(prev => {
        const r = prev.find(x => x.id === id);
        if (r) {
          fetch(`/api/hoja-verif-rawbag/${id}`, {
            method: 'PUT', headers: headers(), body: JSON.stringify(r), keepalive: true,
          })
            .then(res => { if (!res.ok) setMsg('No se pudo guardar la verificación.'); })
            .catch(() => setMsg('No se pudo conectar con el servidor.'));
        }
        return prev;
      });
    }, 800));
  }

  async function eliminar() {
    if (!aEliminar) return;
    setEliminando(true);
    try {
      const res = await fetch(`/api/hoja-verif-rawbag/${aEliminar.id}`, { method: 'DELETE', headers: headers() });
      if (!res.ok) { setMsg('No se pudo eliminar.'); return; }
      setRenglones(prev => prev.filter(r => r.id !== aEliminar.id));
    } finally {
      setEliminando(false);
      setAEliminar(null);
    }
  }

  // Renglones con alguna diferencia entre especificación y real.
  const conDiferencia = useMemo(
    () => renglones.filter(r => PARES.some(([e, a]) => r[a] && r[e] !== r[a])).length,
    [renglones],
  );

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
            Esta verificación pertenece a una orden específica. Elígela desde el área de Big.
          </p>
          <Link href="/produccion/big" className="inline-flex text-sm font-semibold text-white bg-brand-green hover:bg-brand-green-dark rounded-lg px-4 py-2 transition-colors">
            Ir al área de Big
          </Link>
        </div>
      </div>
    );
  }

  // Celda de par especificación/real: resalta en rojo si no coinciden.
  const par = (r: RenglonVerif, campoSpec: keyof RenglonVerif, campoReal: keyof RenglonVerif, ph = '') => {
    const spec = String(r[campoSpec] ?? '');
    const real = String(r[campoReal] ?? '');
    const difiere = !!real && real !== spec;
    return (
      <>
        <td className={celda}>
          <input disabled={!editable} className={`${inp} font-mono`} value={spec} placeholder={ph}
            onChange={e => actualizar(r.id, campoSpec, e.target.value)} />
        </td>
        <td className={celda}>
          <input disabled={!editable} className={`${inp} font-mono ${difiere ? 'text-red-600 font-semibold' : ''}`}
            value={real} placeholder={ph} onChange={e => actualizar(r.id, campoReal, e.target.value)} />
        </td>
      </>
    );
  };

  return (
    <div className="p-4 lg:p-6 max-w-[1500px] mx-auto space-y-4 pb-12">
      <div>
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-sm text-[#6B716C] hover:text-[#1A1A1A] transition-colors mb-3"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Regresar
        </button>
        <h1 className="text-xl lg:text-2xl font-semibold text-[#1A1A1A]">Verificación de área de Raw Bag</h1>
        <p className="text-sm text-[#6B716C]">
          Control de calidad del área de Big. Es registro de verificación: no modifica el avance de la orden.
        </p>
      </div>

      <PestanasHoja pestanas={pestanas} activa="Verificación de área" />

      {bloqueo && (
        <div className="bg-[#FFF7E8] border border-[#E8C88A] rounded-xl px-4 py-3 text-xs text-[#6B5418]">
          <span className="font-semibold">Solo consulta.</span> {bloqueo}
        </div>
      )}
      {!bloqueo && !puede && (
        <div className="bg-[#FFF7E8] border border-[#E8C88A] rounded-xl px-4 py-3 text-xs text-[#6B5418]">
          <span className="font-semibold">Solo consulta.</span> Esta verificación la captura el supervisor de Big (o el administrador).
        </div>
      )}
      {msg && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-[#1A1A1A]">{msg}</div>}
      {conDiferencia > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-[#1A1A1A]">
          <span className="font-bold text-red-700">{conDiferencia}</span>{' '}
          {conDiferencia === 1 ? 'verificación tiene' : 'verificaciones tienen'} algún valor REAL distinto
          a la especificación (marcado en rojo).
        </div>
      )}

      {/* Encabezado */}
      <div className="bg-white border border-[#E2E5E2] rounded-xl shadow-card p-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <Dato label="# de orden" valor={orden.numero_orden} mono />
          <Dato label="Cliente" valor={orden.cliente} />
          <Dato label="Medidas de la orden" valor={orden.medida} mono />
          <Dato label="Supervisor" valor={sesion?.nombre ?? '—'} />
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

      {/* Tabla de verificación */}
      <div className="bg-white border border-[#E2E5E2] rounded-xl shadow-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1500px] text-xs border-collapse">
            <thead>
              <tr className="bg-[#F8FAF8] text-[9px] uppercase tracking-wide text-[#8A9A8C] border-b border-[#E2E5E2]">
                <th className={`${celda} text-left font-medium w-28`} rowSpan={2}>Operador</th>
                <th className={`${celda} font-medium w-16`} rowSpan={2}>Hora</th>
                <th className={`${celda} font-medium w-14`} rowSpan={2}>Puntadas por pulgada</th>
                <th className={`${celda} font-medium w-16`} rowSpan={2}>Hilos (denier)</th>
                <th className={`${celda} font-medium`} colSpan={2}>Medidas del saco</th>
                <th className={`${celda} font-medium`} colSpan={8}>Loops</th>
                <th className={`${celda} font-medium`} colSpan={2}>Diámetro V.D</th>
                <th className={`${celda} font-medium`} colSpan={2}>Material</th>
                <th className={`${celda} font-medium`} colSpan={2}>Filler</th>
                <th className={`${celda} font-medium w-10`} rowSpan={2}>Folt</th>
                <th className={`${celda} font-medium w-10`} rowSpan={2}>PC</th>
                <th className={`${celda} text-left font-medium`} rowSpan={2} style={{ minWidth: 120 }}>Observaciones</th>
                <th className={`${celda} w-8`} rowSpan={2} />
              </tr>
              <tr className="bg-[#F8FAF8] text-[9px] uppercase tracking-wide text-[#8A9A8C] border-b border-[#E2E5E2]">
                <th className={`${celda} font-medium w-28`}>Especif.</th>
                <th className={`${celda} font-medium w-28`}>Real</th>
                <th className={`${celda} font-medium w-12`}>Libre esp.</th>
                <th className={`${celda} font-medium w-12`}>Libre real</th>
                <th className={`${celda} font-medium w-12`}>Trasl. esp.</th>
                <th className={`${celda} font-medium w-12`}>Trasl. real</th>
                <th className={`${celda} font-medium w-12`}>Cost. esp.</th>
                <th className={`${celda} font-medium w-12`}>Cost. real</th>
                <th className={`${celda} font-medium w-14`}>Color esp.</th>
                <th className={`${celda} font-medium w-14`}>Color real</th>
                <th className={`${celda} font-medium w-14`}>Especif.</th>
                <th className={`${celda} font-medium w-14`}>Real</th>
                <th className={`${celda} font-medium w-14`}>Especif.</th>
                <th className={`${celda} font-medium w-14`}>Real</th>
                <th className={`${celda} font-medium w-8`}>1</th>
                <th className={`${celda} font-medium w-8`}>2</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0F5F0]">
              {delDia.map(r => (
                <tr key={r.id} className="hover:bg-[#FBFCFB]">
                  <td className={celda}>
                    <input disabled={!editable} className={inp} value={r.operador} placeholder="Nombre"
                      onChange={e => actualizar(r.id, 'operador', e.target.value)} />
                  </td>
                  <td className={celda}>
                    <input disabled={!editable} type="time" className={`${inp} font-mono`} value={r.hora}
                      onChange={e => actualizar(r.id, 'hora', e.target.value)} />
                  </td>
                  <td className={celda}>
                    <input disabled={!editable} className={`${inp} text-center font-mono`} value={r.puntadas}
                      placeholder="3" onChange={e => actualizar(r.id, 'puntadas', e.target.value)} />
                  </td>
                  <td className={celda}>
                    <input disabled={!editable} className={`${inp} text-center font-mono`} value={r.hilos}
                      placeholder="4000" onChange={e => actualizar(r.id, 'hilos', e.target.value)} />
                  </td>
                  {par(r, 'medida_spec', 'medida_real', '38x38x52"')}
                  {par(r, 'loop_libre_spec', 'loop_libre_real', '10')}
                  {par(r, 'loop_traslape_spec', 'loop_traslape_real', '20')}
                  {par(r, 'loop_costurado_spec', 'loop_costurado_real', '30"')}
                  {par(r, 'loop_color_spec', 'loop_color_real', 'BLANCO')}
                  {par(r, 'diam_spec', 'diam_real', '18"')}
                  {par(r, 'material_spec', 'material_real', '6 oz')}
                  <td className={`${celda} text-center`}>
                    <input type="checkbox" disabled={!editable} checked={r.filler1}
                      onChange={e => actualizar(r.id, 'filler1', e.target.checked)}
                      className="accent-[#009166] w-4 h-4 cursor-pointer" />
                  </td>
                  <td className={`${celda} text-center`}>
                    <input type="checkbox" disabled={!editable} checked={r.filler2}
                      onChange={e => actualizar(r.id, 'filler2', e.target.checked)}
                      className="accent-[#009166] w-4 h-4 cursor-pointer" />
                  </td>
                  <td className={`${celda} text-center`}>
                    <input type="checkbox" disabled={!editable} checked={r.folt}
                      onChange={e => actualizar(r.id, 'folt', e.target.checked)}
                      className="accent-[#009166] w-4 h-4 cursor-pointer" />
                  </td>
                  <td className={`${celda} text-center`}>
                    <input type="checkbox" disabled={!editable} checked={r.pc}
                      onChange={e => actualizar(r.id, 'pc', e.target.checked)}
                      className="accent-[#009166] w-4 h-4 cursor-pointer" />
                  </td>
                  <td className={celda}>
                    <input disabled={!editable} className={inp} value={r.observaciones} placeholder="—"
                      onChange={e => actualizar(r.id, 'observaciones', e.target.value)} />
                  </td>
                  <td className={`${celda} text-center`}>
                    {editable && (
                      <button onClick={() => setAEliminar(r)} title="Quitar verificación" className="text-[#8A9A8C] hover:text-red-600 transition-colors">✕</button>
                    )}
                  </td>
                </tr>
              ))}
              {delDia.length === 0 && !cargando && (
                <tr><td colSpan={22} className="py-6 text-center text-xs text-[#8A9A8C]">
                  Sin verificaciones el {fechaBonita(diaSel)}{editable ? ' — agrega la primera.' : '.'}
                </td></tr>
              )}
              {cargando && (
                <tr><td colSpan={22} className="py-6 text-center text-xs text-[#8A9A8C]">Cargando…</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-3 py-2.5 border-t border-[#E8EFE9] flex items-center justify-between flex-wrap gap-2">
          {editable ? (
            <button
              onClick={agregarRenglon}
              className="text-xs font-semibold text-white bg-brand-green hover:bg-brand-green-dark rounded-lg px-4 py-2 transition-colors"
            >
              + Agregar verificación
            </button>
          ) : <span />}
          <span className="text-[10px] text-[#8A9A8C]">
            Filler: marca 1 o 2 según lleve en ambos lados, igual que Folt; si no lleva, déjalos sin marcar ·
            PC: ausencia de contaminación en el contenedor (metal, cartón, hilos o madera) ·
            En rojo: el REAL no coincide con la especificación.
          </span>
        </div>
      </div>

      <ConfirmModal
        open={!!aEliminar}
        onClose={() => setAEliminar(null)}
        onConfirm={eliminar}
        titulo="Quitar verificación"
        variante="peligro"
        confirmarTexto="Quitar"
        cargando={eliminando}
      >
        ¿Quitar la verificación de <span className="font-semibold text-[#1A1A1A]">{aEliminar?.operador || 'sin operador'}</span>
        {aEliminar?.hora ? <> de las {aEliminar.hora}</> : null}?
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
