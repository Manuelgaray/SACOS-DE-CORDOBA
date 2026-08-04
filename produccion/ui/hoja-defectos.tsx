'use client';

// ─────────────────────────────────────────────────────────────────────────────
//  FORMATO DE DEFECTOS Y HALLAZGOS EN PROCESO — segunda hoja del área de Calidad.
//
//  Réplica de la hoja física (PRO-FOR-016): un renglón por saco con hallazgo —
//  mesa, etiqueta, máquina, operador, tipo de defecto (catálogo PS, MP, HD…) y
//  si se aprobó o se rechazó. Es solo registro de calidad: NO afecta el avance
//  del área (ese sale del control de mesas).
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useProduccion } from '@/produccion/produccion-store';
import BotonImprimir from '@/produccion/ui/BotonImprimir';
import { useSession } from '@/autenticacion/auth';
import { AREA_LABELS } from '@/compartido/mock-data';
import { ConfirmModal } from '@/compartido/ui/Modal';
import PestanasHoja, { pestanasCalidad, PESTANA_DEFECTOS } from '@/produccion/ui/PestanasHoja';

// Catálogo de defectos del pie de la hoja física.
const DEFECTOS = [
  { codigo: 'PS', nombre: 'Puntada saltada' },
  { codigo: 'MP', nombre: 'Mal empalmado' },
  { codigo: 'HD', nombre: 'Hilo desfibrado' },
  { codigo: 'DM', nombre: 'Desviación de medidas' },
  { codigo: 'MI', nombre: 'Manchas internas' },
  { codigo: 'TS', nombre: 'Tela sucia' },
  { codigo: 'CC', nombre: 'Cintas costuradas' },
  { codigo: 'TD', nombre: 'Tela con defecto' },
  { codigo: 'FE', nombre: 'Falta etiqueta' },
  { codigo: 'CF', nombre: 'Contaminante físico o químico dentro' },
  { codigo: 'FAC', nombre: 'Falta de accesorios' },
  { codigo: 'TR', nombre: 'Tela rota' },
  { codigo: 'FL', nombre: 'Falla de liner' },
  { codigo: 'FAN', nombre: 'Falla antifuga' },
];

const NOMBRE_DEFECTO = new Map(DEFECTOS.map(d => [d.codigo, d.nombre]));

// Cómo se resolvió el hallazgo (en el papel se escribe "Reparado/Aprobado").
const RESULTADOS = ['Reparado/Aprobado', 'Aprobado', 'Rechazado'];

// Turnos de la planta (va en el encabezado de la hoja, como en el papel).
const TURNOS = ['1°', '2°'];

interface RenglonDefecto {
  id: number;
  fecha: string;
  turno: string;
  mesa: string;
  etiqueta: string;
  maquina: string;
  operador: string;
  defecto: string;
  resultado: string;
}

type CampoDefecto = 'turno' | 'mesa' | 'etiqueta' | 'maquina' | 'operador' | 'defecto' | 'resultado';

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

export default function HojaDefectosPage() {
  const { ordenes, estados, ready } = useProduccion();
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

  const [renglones, setRenglones] = useState<RenglonDefecto[]>([]);
  const [cargando, setCargando] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [aEliminar, setAEliminar] = useState<RenglonDefecto | null>(null);
  const [eliminando, setEliminando] = useState(false);

  const headers = useCallback(
    () => ({ 'Content-Type': 'application/json', 'x-user-email': sesion?.email ?? '' }),
    [sesion?.email],
  );

  useEffect(() => {
    if (!orden?.id || !sesion?.email) return;
    let cancelado = false;
    setCargando(true);
    fetch(`/api/hoja-defectos?orden=${encodeURIComponent(orden.id)}`, { headers: { 'x-user-email': sesion.email } })
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (cancelado || !data) return;
        setRenglones(data.renglones as RenglonDefecto[]);
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

  // ── Turno de la hoja ────────────────────────────────────────────────────────
  // En el papel el turno va en el encabezado, no renglón por renglón: aquí se
  // captura arriba y se aplica a todos los hallazgos de ese día.
  const [turnoNuevo, setTurnoNuevo] = useState('');
  const turnoDia = delDia.length > 0 ? delDia[0].turno : turnoNuevo;

  function cambiarTurno(valor: string) {
    setTurnoNuevo(valor);
    if (delDia.length === 0) return;
    setRenglones(prev => prev.map(r => (r.fecha === diaSel ? { ...r, turno: valor } : r)));
    for (const r of delDia) guardar(r.id);
  }

  // ── Acciones ────────────────────────────────────────────────────────────────
  async function agregarRenglon() {
    if (!orden) return;
    setMsg(null);
    const res = await fetch('/api/hoja-defectos', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ orden_id: orden.id, fecha: diaSel, turno: turnoDia }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setMsg(data?.error ?? 'No se pudo agregar el hallazgo.'); return; }
    setRenglones(prev => [...prev, data.renglon as RenglonDefecto]);
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
          fetch(`/api/hoja-defectos/${id}`, {
            method: 'PUT',
            headers: headers(),
            body: JSON.stringify(r),
            keepalive: true,
          })
            .then(res => res.json().catch(() => ({})).then(data => {
              if (!res.ok) setMsg(data?.error ?? 'No se pudo guardar el hallazgo.');
            }))
            .catch(() => setMsg('No se pudo conectar con el servidor.'));
        }
        return prev;
      });
    }, 800));
  }

  function actualizar(id: number, campo: CampoDefecto, valor: string) {
    setRenglones(prev => prev.map(r => (r.id === id ? { ...r, [campo]: valor } : r)));
    guardar(id);
  }

  async function eliminar() {
    if (!aEliminar) return;
    setEliminando(true);
    try {
      const res = await fetch(`/api/hoja-defectos/${aEliminar.id}`, { method: 'DELETE', headers: headers() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg(data?.error ?? 'No se pudo eliminar.'); return; }
      setRenglones(prev => prev.filter(r => r.id !== aEliminar.id));
    } finally {
      setEliminando(false);
      setAEliminar(null);
    }
  }

  // ── Resumen de hallazgos de la orden (todos los días) ───────────────────────
  const resumen = useMemo(() => {
    const porTipo = new Map<string, number>();
    let rechazados = 0;
    for (const r of renglones) {
      const cod = r.defecto.trim().toUpperCase();
      if (cod) porTipo.set(cod, (porTipo.get(cod) ?? 0) + 1);
      if (r.resultado === 'Rechazado') rechazados += 1;
    }
    return {
      total: renglones.length,
      rechazados,
      porTipo: [...porTipo.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [renglones]);

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
        <h1 className="text-xl lg:text-2xl font-semibold text-[#1A1A1A]">
          Formato de defectos y hallazgos en proceso
        </h1>
        <p className="text-sm text-[#6B716C]">
          Hoja de {AREA_LABELS.calidad}: los sacos con defecto detectados en las mesas y cómo se
          resolvieron. Es registro de calidad, no cuenta para el avance del área.
        </p>
        <BotonImprimir orden={orden.id} hoja="defectos" permitido={puede} />
      </div>

      <PestanasHoja pestanas={pestanasCalidad(orden.id)} activa={PESTANA_DEFECTOS} />

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
              className="w-full px-2 py-1 text-xs font-semibold border border-[#E2E5E2] rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-brand-green focus:border-brand-green transition-colors disabled:bg-[#F8FAF8] disabled:text-[#6B716C]"
              value={turnoDia}
              onChange={e => cambiarTurno(e.target.value)}
            >
              <option value="">—</option>
              {TURNOS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
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
          <table className="w-full min-w-[900px] text-xs border-collapse">
            <thead>
              <tr className="bg-[#F8FAF8] text-[9px] uppercase tracking-wide text-[#8A9A8C] border-b border-[#E2E5E2]">
                <th className={`${celda} font-medium w-16`}># Mesa</th>
                <th className={`${celda} font-medium w-24`}># Etiqueta</th>
                <th className={`${celda} font-medium w-24`}># Máquina</th>
                <th className={`${celda} text-left font-medium w-40`}>Operador</th>
                <th className={`${celda} text-left font-medium`} style={{ minWidth: 220 }}>Tipo de defecto</th>
                <th className={`${celda} text-left font-medium w-44`}>Aprobado / Rechazado</th>
                <th className={`${celda} w-8`} />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0F5F0]">
              {delDia.map(r => (
                <tr key={r.id} className={r.resultado === 'Rechazado' ? 'bg-red-50/60' : 'hover:bg-[#FBFCFB]'}>
                  <td className={celda}>
                    <input disabled={!editable} className={`${inp} text-center font-mono`} value={r.mesa}
                      placeholder="#" onChange={e => actualizar(r.id, 'mesa', e.target.value)} />
                  </td>
                  <td className={celda}>
                    <input disabled={!editable} className={`${inp} text-center font-mono`} value={r.etiqueta}
                      placeholder="#" onChange={e => actualizar(r.id, 'etiqueta', e.target.value)} />
                  </td>
                  <td className={celda}>
                    <input disabled={!editable} className={`${inp} text-center font-mono`} value={r.maquina}
                      placeholder="#" onChange={e => actualizar(r.id, 'maquina', e.target.value)} />
                  </td>
                  <td className={celda}>
                    <input disabled={!editable} className={inp} value={r.operador}
                      placeholder="Nombre" onChange={e => actualizar(r.id, 'operador', e.target.value)} />
                  </td>
                  <td className={celda}>
                    <select
                      disabled={!editable}
                      className={`${inp} cursor-pointer disabled:cursor-default`}
                      value={r.defecto}
                      onChange={e => actualizar(r.id, 'defecto', e.target.value)}
                    >
                      <option value="">— Elige el defecto —</option>
                      {DEFECTOS.map(d => (
                        <option key={d.codigo} value={d.codigo}>{d.codigo} · {d.nombre}</option>
                      ))}
                    </select>
                  </td>
                  <td className={celda}>
                    <select
                      disabled={!editable}
                      className={`${inp} cursor-pointer disabled:cursor-default font-semibold ${
                        r.resultado === 'Rechazado' ? 'text-red-700' : r.resultado ? 'text-[#047150]' : ''
                      }`}
                      value={r.resultado}
                      onChange={e => actualizar(r.id, 'resultado', e.target.value)}
                    >
                      <option value="">—</option>
                      {RESULTADOS.map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </td>
                  <td className={`${celda} text-center`}>
                    {editable && (
                      <button onClick={() => setAEliminar(r)} title="Quitar hallazgo" className="text-[#8A9A8C] hover:text-red-600 transition-colors">✕</button>
                    )}
                  </td>
                </tr>
              ))}
              {delDia.length === 0 && !cargando && (
                <tr><td colSpan={7} className="py-6 text-center text-xs text-[#8A9A8C]">
                  Sin hallazgos el {fechaBonita(diaSel)}{editable ? ' — agrega el primero si aparece alguno.' : '.'}
                </td></tr>
              )}
              {cargando && (
                <tr><td colSpan={7} className="py-6 text-center text-xs text-[#8A9A8C]">Cargando hoja…</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {editable && (
          <div className="px-3 py-2.5 border-t border-[#E8EFE9]">
            <button
              onClick={agregarRenglon}
              className="text-xs font-semibold text-white bg-brand-green hover:bg-brand-green-dark rounded-lg px-4 py-2 transition-colors"
            >
              + Agregar hallazgo
            </button>
          </div>
        )}
      </div>

      {/* Resumen de la orden */}
      {resumen.total > 0 && (
        <div className="bg-white border border-[#E2E5E2] rounded-xl shadow-card p-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h3 className="text-xs font-semibold text-[#1A1A1A] uppercase tracking-wide">
              Hallazgos de la orden
            </h3>
            <span className="text-xs font-mono text-[#6B716C]">
              <span className="font-bold text-[#1A1A1A]">{resumen.total}</span> en total
              {resumen.rechazados > 0 && (
                <> · <span className="font-bold text-red-700">{resumen.rechazados}</span> rechazados</>
              )}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {resumen.porTipo.map(([codigo, n]) => (
              <span
                key={codigo}
                title={NOMBRE_DEFECTO.get(codigo) ?? codigo}
                className="text-[11px] rounded-lg px-2 py-1 bg-[#F0F5F0] border border-[#E2E5E2] text-[#1A1A1A]"
              >
                <span className="font-bold font-mono">{codigo}</span>
                <span className="text-[#6B716C]"> {NOMBRE_DEFECTO.get(codigo) ?? ''} · </span>
                <span className="font-bold font-mono">{n}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Catálogo del pie de la hoja física */}
      <div className="bg-white border border-[#E2E5E2] rounded-xl shadow-card p-4">
        <h3 className="text-xs font-semibold text-[#1A1A1A] uppercase tracking-wide mb-3">Tipo de defecto</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1.5">
          {DEFECTOS.map(d => (
            <div key={d.codigo} className="flex items-baseline justify-between gap-3 text-[11px] border-b border-dotted border-[#E8EFE9] pb-1">
              <span className="text-[#6B716C]">{d.nombre}</span>
              <span className="font-mono font-bold text-[#1A1A1A]">{d.codigo}</span>
            </div>
          ))}
        </div>
      </div>

      <ConfirmModal
        open={!!aEliminar}
        onClose={() => setAEliminar(null)}
        onConfirm={eliminar}
        titulo="Quitar hallazgo"
        variante="peligro"
        confirmarTexto="Quitar"
        cargando={eliminando}
      >
        ¿Quitar el hallazgo de la etiqueta{' '}
        <span className="font-semibold text-[#1A1A1A]">{aEliminar?.etiqueta || 'sin número'}</span>
        {aEliminar?.defecto ? <> ({aEliminar.defecto})</> : null}?
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
