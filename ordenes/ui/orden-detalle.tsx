'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AREA_LABELS, AREA_COLORS, formatDate, formatDateShort, formatFechaHora, type OrderStatus } from '@/compartido/mock-data';
import { useProduccion } from '@/produccion/produccion-store';
import { progresoArea, progresoComponente, progresoOrden, areaEnCurso, rutaHojaDeArea } from '@/produccion/produccion';
import BotonImprimir from '@/produccion/ui/BotonImprimir';
import { useSession } from '@/autenticacion/auth';
import { ConfirmModal } from '@/compartido/ui/Modal';
import ExplosionMateriales from '@/explosion-materiales/ui/ExplosionMateriales';
import PdfViewer from '@/compartido/ui/PdfViewer';

const STATUS_MAP = {
  activa:     { bg: 'bg-brand-green-light',  text: 'text-[#1A1A1A]',       label: 'Activa',      dot: 'bg-brand-green' },
  programada: { bg: 'bg-brand-orange-light', text: 'text-[#1A1A1A]', label: 'Programada',  dot: 'bg-brand-orange' },
  pausada:    { bg: 'bg-[#ECEAF2]',          text: 'text-[#1A1A1A]',         label: 'Pausada',     dot: 'bg-[#6F6391]' },
  terminada:  { bg: 'bg-[#E0E7E1]',          text: 'text-[#1A1A1A]',  label: 'Terminada',   dot: 'bg-brand-green-dark' },
  cancelada:  { bg: 'bg-red-50',             text: 'text-[#1A1A1A]',           label: 'Cancelada',   dot: 'bg-red-500' },
} as const;

const ESTADO_OPCIONES: OrderStatus[] = ['activa', 'programada', 'pausada', 'terminada', 'cancelada'];

export default function OrdenDetallePage({ params }: { params: { id: string } }) {
  const { ordenes, avances, estados, ready, setEstado, patchOrden, cargarOrden } = useProduccion();
  const { sesion } = useSession();
  const esAdmin = sesion?.rol === 'admin';
  const orden = ordenes.find(o => o.id === params.id);

  // El store solo trae lo activo y lo reciente. Si se abre una orden vieja del
  // histórico (o un enlace directo), se pide por id antes de darla por perdida.
  const [buscandoOrden, setBuscandoOrden] = useState(false);
  const intentado = useRef(false);
  useEffect(() => {
    if (!ready || orden || intentado.current) return;
    intentado.current = true;
    setBuscandoOrden(true);
    cargarOrden(params.id).finally(() => setBuscandoOrden(false));
  }, [ready, orden, params.id, cargarOrden]);

  // Autorización de la orden (solo admin firma).
  const [confirmarAutorizar, setConfirmarAutorizar] = useState(false);
  const [autorizando, setAutorizando] = useState(false);
  const [autError, setAutError] = useState<string | null>(null);

  async function autorizar() {
    if (!orden) return;
    setAutorizando(true);
    setAutError(null);
    try {
      const res = await fetch(`/api/ordenes/${orden.id}/autorizar`, {
        method: 'POST',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAutError(data?.error ?? 'No se pudo autorizar la orden.');
        return;
      }
      patchOrden(orden.id, {
        autorizado_por: data.autorizado_por as string,
        fecha_autorizacion: data.fecha_autorizacion as string,
      });
    } catch {
      setAutError('No se pudo conectar con el servidor.');
    } finally {
      setAutorizando(false);
      setConfirmarAutorizar(false);
    }
  }

  if (!ready || buscandoOrden) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[40vh] text-sm text-[#6B716C]">
        <svg className="animate-spin h-4 w-4 mr-2" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Cargando orden...
      </div>
    );
  }

  if (!orden) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <Link href="/ordenes" className="flex items-center gap-2 text-sm text-[#1A1A1A] mb-6 hover:text-[#1A1A1A]">
          ← Volver a órdenes
        </Link>
        <div className="bg-white border border-[#E2E5E2] rounded-xl p-10 text-center shadow-card">
          <p className="text-[#6B716C]">Orden no encontrada.</p>
        </div>
      </div>
    );
  }

  const est = (estados[orden.id] ?? orden.status) as OrderStatus;
  const s = STATUS_MAP[est];
  const linea = orden.linea;
  const avance = avances[orden.id] ?? [];
  const progress = progresoOrden(avance);
  const enCurso = areaEnCurso(avance);
  const isVencida = orden.fecha_entrega && new Date(orden.fecha_entrega) < new Date() && est === 'activa';

  return (
    <div className="p-4 lg:p-6 max-w-5xl mx-auto space-y-5 pb-12">

      {/* Back */}
      <div>
        <Link href="/ordenes" className="flex items-center gap-1.5 text-sm text-[#6B716C] hover:text-[#1A1A1A] transition-colors">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Volver a órdenes
        </Link>
      </div>

      {/* Header */}
      <div className="bg-white border border-[#E2E5E2] rounded-xl shadow-card overflow-hidden">
        <div className="bg-brand-green-50 px-5 py-4 border-b border-[#E2E5E2]">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-xl font-black text-[#1A1A1A] font-mono">{orden.numero_orden}</h1>
                {linea && (
                  <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold bg-[#2A2E2B] text-white">
                    LÍNEA {linea}
                  </span>
                )}
                {isVencida && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-[#1A1A1A]">
                    ⚠ FMF Vencida
                  </span>
                )}
                {orden.grado && (
                  <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-bold bg-brand-orange-light text-[#1A1A1A]">
                    ★ {orden.grado}
                  </span>
                )}
              </div>
              <p className="text-sm text-[#6B716C] mt-0.5">{orden.cliente}</p>
              {/* La carátula (VEN-FOR-005) es el documento que acompaña a la
                  orden en planta: se imprime tal cual el preimpreso. */}
              <BotonImprimir
                orden={orden.id}
                hoja="caratula"
                texto="Descargar carátula"
                className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-[#1A6B4A] border border-brand-green/40 bg-white hover:bg-brand-green-50 rounded-lg px-3 py-1.5 transition-colors"
              />
            </div>
            <div className="text-right">
              {/* Estado: solo un admin puede cambiarlo; los demás lo ven fijo */}
              <div className="flex items-center gap-1.5 justify-end mb-1.5">
                <span className="text-[10px] uppercase tracking-wide text-[#8A9A8C]">Estado</span>
                {esAdmin ? (
                  <select
                    value={est}
                    onChange={(e) => setEstado(orden.id, e.target.value as OrderStatus)}
                    disabled={!ready}
                    className={`text-xs font-semibold rounded-md border px-2 py-1 cursor-pointer focus:outline-none focus:ring-1 focus:ring-brand-green ${s.bg} ${s.text}`}
                  >
                    {ESTADO_OPCIONES.map(o => (
                      <option key={o} value={o}>{STATUS_MAP[o].label}</option>
                    ))}
                  </select>
                ) : (
                  <span className={`inline-flex items-center gap-1.5 text-xs font-semibold rounded-md px-2 py-1 ${s.bg} ${s.text}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
                    {s.label}
                  </span>
                )}
              </div>
              <div className="text-xs text-[#8A9A8C]">Elaborado: {formatDate(orden.fecha_creacion)}</div>
              <div className={`text-xs font-semibold mt-0.5 ${isVencida ? 'text-[#1A1A1A]' : 'text-[#1A1A1A]'}`}>
                FMF: {formatDate(orden.fecha_entrega)}
              </div>
            </div>
          </div>
        </div>

        {/* Grid de datos principales */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-0 divide-x divide-y divide-[#E8EFE9]">
          <InfoCell label="Spec" value={orden.spec} mono />
          <InfoCell label="Medida" value={orden.medida} mono />
          <InfoCell label="Tipo de saco" value={orden.tipo_saco} />
          <InfoCell label="Cantidad" value={`${orden.cantidad.toLocaleString()} pzas`} mono />
          <InfoCell label="Carga" value={`${orden.carga_lbs.toLocaleString()} Lbs`} />
          <InfoCell label="No. Orden Cliente" value={orden.orden_cliente ?? '—'} mono />
          <InfoCell label="Embarcar a" value={orden.embarcar_a ?? '—'} />
          <InfoCell label="Inicio" value={formatDateShort(orden.fecha_inicio)} />
        </div>

        {/* Progreso global */}
        <div className="px-5 py-3 border-t border-[#E8EFE9]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-[#6B716C]">Avance global de la orden</span>
            <span className="text-sm font-bold text-[#1A1A1A]">{progress}%</span>
          </div>
          <div className="h-2.5 bg-[#E8EFE9] rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${est === 'pausada' ? 'bg-[#8077A0]' : 'bg-brand-green'}`}
              style={{ width: `${progress}%` }}
            />
          </div>
          {enCurso && (
            <div className="mt-1.5 text-[11px] text-[#8A9A8C]">
              Frente de trabajo: <span className="font-medium text-[#1A1A1A]">{AREA_LABELS[enCurso]}</span>
            </div>
          )}
        </div>
      </div>

      {/* Reglas: la orden no procede si está programada/pausada o sin autorizar */}
      {(est !== 'activa' || !orden.autorizado_por) && est !== 'terminada' && est !== 'cancelada' && (
        <div className="flex items-start gap-2.5 bg-[#FFF7E8] border border-[#E8C88A] rounded-xl px-4 py-3">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className="flex-shrink-0 mt-0.5">
            <rect x="3.5" y="8" width="11" height="7" rx="1.5" stroke="#9A6A12" strokeWidth="1.5" />
            <path d="M6 8V6a3 3 0 016 0v2" stroke="#9A6A12" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <div className="text-xs text-[#6B5418] space-y-0.5">
            {est !== 'activa' && (
              <div>
                <span className="font-semibold">Orden {STATUS_MAP[est].label.toLowerCase()}.</span>{' '}
                Ningún área puede capturar avance hasta que esté <span className="font-semibold">activa</span>.
              </div>
            )}
            {!orden.autorizado_por && (
              <div>
                <span className="font-semibold">Sin autorizar.</span>{' '}
                Un administrador debe autorizar la orden (firma de abajo) para que producción pueda proceder.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Avance por área — captura */}
      <Section title="Avance de producción por área" icon="">
        <div className="space-y-3">
          {avance.map(av => {
            const c = AREA_COLORS[av.area];
            const p = progresoArea(av);
            return (
              <Link
                key={av.area}
                // Se entra con la orden ya elegida: las áreas que capturan en
                // hoja la abren directo; las demás quedan enfocadas en esta orden.
                href={rutaHojaDeArea(av.area, orden.id) ?? `/produccion/${av.area}?orden=${orden.id}`}
                className="block rounded-lg border border-[#E8EFE9] hover:border-brand-green/30 hover:shadow-sm transition-all overflow-hidden"
              >
                <div className="flex items-center justify-between px-3 py-2">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded ${c.bg} ${c.text}`}>
                    {AREA_LABELS[av.area]}
                  </span>
                  <span className="text-xs font-bold text-[#1A1A1A]">{p}%</span>
                </div>
                <div className="px-3 pb-2 space-y-1.5">
                  <div className="h-1.5 bg-[#E8EFE9] rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${p >= 100 ? 'bg-brand-green' : 'bg-brand-orange'}`} style={{ width: `${p}%` }} />
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                    {av.componentes.map((comp, i) => (
                      <span key={i} className="text-[10px] text-[#6B716C]">
                        {comp.nombre}: <span className="font-mono font-medium text-[#1A1A1A]">{comp.hecho.toLocaleString()}/{comp.meta.toLocaleString()}</span>
                        {progresoComponente(comp) >= 100 && <span className="text-[#1A1A1A]"> ✓</span>}
                      </span>
                    ))}
                  </div>
                  {av.ultimoReporte && (
                    <div className="text-[10px] text-[#8A9A8C]">
                      Último reporte: <span className="font-medium text-[#6B716C]">{formatFechaHora(av.ultimoReporte.fecha)}</span>
                      {av.ultimoReporte.usuario && <> · {av.ultimoReporte.usuario}</>}
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      </Section>

      {/* Explosión de materiales (corte) */}
      <Section title="Explosión de materiales (corte)" icon="">
        <ExplosionMateriales orden={orden} />
      </Section>

      {/* PDF de la orden — diseño y especificaciones */}
      <Section title="Diseño y especificaciones (PDF)" icon="">
        {orden.pdf_url ? (
          <div className="space-y-3">
            {/* Solo visor incrustado — sin botón de descarga: el diseño es
                información sensible de la empresa y se consulta dentro de la app. */}
            <PdfViewer url={orden.pdf_url} />
          </div>
        ) : (
          <p className="text-sm text-[#6B716C]">
            Esta orden no tiene PDF cargado (es una orden de ejemplo). Las órdenes nuevas se crean
            subiendo el PDF del diseño desde <span className="font-medium text-[#1A1A1A]">Nueva orden</span>.
          </p>
        )}
      </Section>

      {/* Footer firma — datos reales de quién elaboró y quién autorizó */}
      <div className="bg-white border border-[#E2E5E2] rounded-xl p-4 shadow-card">
        <div className="grid grid-cols-2 gap-4 text-xs text-[#6B716C]">
          <div>
            <div className="font-medium text-[#1A1A1A] mb-0.5">Elaboró</div>
            <div className="font-semibold text-[#1A1A1A]">{orden.elaborado_por ?? '—'}</div>
            <div className="mt-0.5">{formatDate(orden.fecha_creacion)}</div>
          </div>
          <div>
            <div className="font-medium text-[#1A1A1A] mb-0.5">Autorizó</div>
            {orden.autorizado_por ? (
              <>
                <div className="font-semibold text-[#1A1A1A]">{orden.autorizado_por}</div>
                <div className="mt-0.5">{formatDate(orden.fecha_autorizacion)}</div>
              </>
            ) : (
              <>
                <div className="italic text-[#8A9A8C]">Pendiente de autorización</div>
                {esAdmin && (
                  <button
                    onClick={() => { setAutError(null); setConfirmarAutorizar(true); }}
                    className="mt-1.5 text-xs font-semibold text-white bg-brand-green hover:bg-brand-green-dark rounded-md px-3 py-1.5 transition-colors"
                  >
                    Autorizar orden
                  </button>
                )}
              </>
            )}
          </div>
        </div>
        {autError && (
          <div className="mt-3 bg-red-50 border border-red-200 text-[#1A1A1A] text-xs rounded-lg px-3 py-2">
            {autError}
          </div>
        )}
      </div>

      {/* Confirmación de autorización */}
      <ConfirmModal
        open={confirmarAutorizar}
        onClose={() => setConfirmarAutorizar(false)}
        onConfirm={autorizar}
        titulo="Autorizar orden"
        confirmarTexto="Autorizar"
        cargando={autorizando}
      >
        ¿Autorizar la orden <span className="font-mono font-semibold text-[#1A1A1A]">{orden.numero_orden}</span>?
        Quedará firmada a tu nombre (<span className="font-semibold text-[#1A1A1A]">{sesion?.nombre}</span>) con la fecha de hoy.
      </ConfirmModal>
    </div>
  );
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function InfoCell({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="px-4 py-3">
      <div className="text-[10px] uppercase tracking-wide text-[#8A9A8C] font-medium mb-0.5">{label}</div>
      {/* whitespace-pre-line: "Embarcar a" puede traer varios destinos, uno por renglón. */}
      <div className={`text-sm font-semibold text-[#1A1A1A] whitespace-pre-line ${mono ? 'font-mono' : ''}`}>{value}</div>
    </div>
  );
}

function Section({ title, icon, children, urgent }: {
  title: string; icon: string; children: React.ReactNode; urgent?: boolean;
}) {
  return (
    <div className={`bg-white border rounded-xl shadow-card overflow-hidden ${urgent ? 'border-brand-orange/30' : 'border-[#E2E5E2]'}`}>
      <div className={`flex items-center gap-2 px-4 py-2.5 border-b ${urgent ? 'border-brand-orange/20 bg-brand-orange-light/30' : 'border-[#E8EFE9] bg-brand-green-50/40'}`}>
        <span className="text-base">{icon}</span>
        <h2 className={`text-sm font-semibold ${urgent ? 'text-[#1A1A1A]' : 'text-[#1A1A1A]'}`}>{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}
