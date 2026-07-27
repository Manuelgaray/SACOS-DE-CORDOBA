'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { AREAS_FLOW, AREA_LABELS, AREA_COLORS, formatFechaHora, type Area, type OrderStatus } from '@/compartido/mock-data';
import { useProduccion } from '@/produccion/produccion-store';
import { progresoArea, progresoComponente, rutaHojaDeArea, type ComponenteProduccion } from '@/produccion/produccion';
import { useSession, puedeCapturar } from '@/autenticacion/auth';
import NumeroInput from '@/compartido/ui/NumeroInput';

export default function CapturaAreaPage() {
  const params = useParams();
  const router = useRouter();
  const area = params.area as Area;
  // Si se llega desde una orden (?orden=), la vista queda enfocada en ella:
  // no hay que volver a buscarla entre todas.
  const enfocada = useSearchParams().get('orden');
  const { ordenes: todasOrdenes, avances, estados, ready, setHecho } = useProduccion();
  const { sesion } = useSession();
  const editable = puedeCapturar(sesion, area);

  if (!AREAS_FLOW.includes(area)) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <Link href="/produccion" className="text-sm text-[#1A1A1A]">← Producción</Link>
        <p className="mt-6 text-[#6B716C]">Área no válida.</p>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[40vh] text-sm text-[#6B716C]">
        <svg className="animate-spin h-4 w-4 mr-2" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Cargando...
      </div>
    );
  }

  const c = AREA_COLORS[area];
  const estadoDe = (id: string): OrderStatus => estados[id] ?? todasOrdenes.find(o => o.id === id)!.status;

  // Órdenes que pasan por esta área. POSICIÓN FIJA: las más recientes arriba,
  // las viejas abajo — el orden NO cambia al capturar avances. Las terminadas
  // y las que ya completaron el área siguen visibles (no desaparecen).
  const ordenes = todasOrdenes
    .filter(o => ['activa', 'pausada', 'terminada'].includes(estadoDe(o.id)))
    .map(o => {
      const av = avances[o.id]?.find(a => a.area === area);
      return { orden: o, av, prog: av ? progresoArea(av) : 0 };
    })
    .filter(x => x.av)
    .filter(x => !enfocada || x.orden.id === enfocada)
    .sort((a, b) => b.orden.fecha_creacion.localeCompare(a.orden.fecha_creacion));

  return (
    <div className="p-4 lg:p-6 max-w-5xl mx-auto space-y-5 pb-12">
      {/* Header */}
      <div>
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-sm text-[#6B716C] hover:text-[#1A1A1A] transition-colors mb-3"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Regresar
        </button>
        <div className="flex items-center gap-3 flex-wrap">
          <span className={`inline-flex px-3 py-1 rounded-lg text-sm font-bold ${c.bg} ${c.text}`}>
            {AREA_LABELS[area]}
          </span>
          <h1 className="text-xl font-semibold text-[#1A1A1A]">
            {area === 'corte' ? 'Hojas de corte'
              : area === 'small' || area === 'tips' ? 'Control de material'
              : area === 'big' || area === 'tapa' ? 'Raw Bag y Tapa'
              : area === 'calidad' ? 'Control de mesas de calidad'
              : area === 'empaque' ? 'Control de tarimas y sacos en prensa'
              : 'Captura de producción'}
          </h1>
        </div>
        <p className="text-sm text-[#6B716C] mt-1">
          {ordenes.length} {ordenes.length === 1 ? 'orden' : 'órdenes'} en cola · captura cuántas piezas llevas
        </p>
      </div>

      {enfocada && ordenes.length > 0 && (
        <div className="flex items-center justify-between gap-3 flex-wrap bg-brand-green-50 border border-brand-green/30 rounded-xl px-4 py-2.5">
          <span className="text-xs text-[#1A1A1A]">
            Mostrando solo la orden <span className="font-mono font-bold">{ordenes[0].orden.numero_orden}</span>.
          </span>
          <Link href={`/produccion/${area}`} className="text-xs font-medium text-[#1A6B4A] hover:underline">
            Ver todas las órdenes del área
          </Link>
        </div>
      )}

      {!editable && (
        <div className="flex items-start gap-2.5 bg-[#FFF7E8] border border-[#E8C88A] rounded-xl px-4 py-3">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className="flex-shrink-0 mt-0.5">
            <rect x="3.5" y="8" width="11" height="7" rx="1.5" stroke="#9A6A12" strokeWidth="1.5" />
            <path d="M6 8V6a3 3 0 016 0v2" stroke="#9A6A12" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <div className="text-xs text-[#6B5418]">
            <span className="font-semibold">Solo lectura.</span> La captura en {AREA_LABELS[area]} está
            habilitada solo para el supervisor de esta área o el administrador. Puedes consultar el avance,
            pero no modificarlo.
          </div>
        </div>
      )}

      {ordenes.length === 0 ? (
        <div className="bg-white border border-[#E2E5E2] rounded-2xl p-10 text-center shadow-card">
          <div className="w-14 h-14 rounded-2xl bg-brand-green-light flex items-center justify-center mx-auto mb-4">
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
              <circle cx="14" cy="14" r="12" stroke="#009166" strokeWidth="2" />
              <path d="M9 14l3.5 3.5L19 10" stroke="#009166" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h2 className="text-base font-semibold text-[#1A1A1A] mb-1">¡Área al día!</h2>
          <p className="text-sm text-[#6B716C]">No hay órdenes pendientes en {AREA_LABELS[area]}.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {ordenes.map(({ orden, av, prog }) => {
            // Reglas de la orden: solo ACTIVA + AUTORIZADA acepta captura
            // (el servidor también lo valida; aquí se explica el porqué).
            const est = estadoDe(orden.id);
            const bloqueo =
              est === 'terminada'
                ? 'Orden terminada: la captura quedó cerrada.'
                : est !== 'activa'
                ? 'Orden pausada: la captura se reanuda cuando un administrador la active.'
                : !orden.autorizado_por
                ? 'Pendiente de autorización: un administrador debe autorizar la orden antes de capturar avance.'
                : null;
            // Estas áreas no capturan por componentes: cada orden abre su HOJA,
            // que es la captura oficial (ver rutaHojaDeArea).
            const conHoja = rutaHojaDeArea(area, orden.id);
            // En Calidad el avance se lleva dentro de la hoja de mesas, así que
            // la tarjeta no repite el porcentaje ni la barra.
            const sinAvance = area === 'calidad';
            if (conHoja) {
              return (
                <Link
                  key={orden.id}
                  href={conHoja}
                  className="block bg-white border border-[#E2E5E2] rounded-xl shadow-card hover:shadow-card-hover hover:border-brand-green/40 transition-all overflow-hidden"
                >
                  <div className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-[#1A1A1A] font-mono">{orden.numero_orden}</span>
                        {orden.linea && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#2A2E2B] text-white">
                            LÍNEA {orden.linea}
                          </span>
                        )}
                        {prog >= 100 && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-brand-green-light text-[#047150]">
                            ÁREA TERMINADA
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-[#6B716C] truncate">
                        {orden.cliente} · {orden.tipo_saco} · <span className="font-mono">{orden.cantidad.toLocaleString()}</span> sacos
                      </div>
                      <div className="text-[10px] text-[#8A9A8C]">
                        {av!.ultimoReporte
                          ? <>Último reporte: <span className="font-medium text-[#6B716C]">{formatFechaHora(av!.ultimoReporte.fecha)}</span>{av!.ultimoReporte.usuario && <> · {av!.ultimoReporte.usuario}</>}</>
                          : 'Sin reportes aún'}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      {!sinAvance && (
                        <div className="text-right">
                          <div className="text-lg font-bold text-[#1A1A1A] leading-none">{prog}%</div>
                          <div className="text-[10px] text-[#8A9A8C]">avance área</div>
                        </div>
                      )}
                      <span className="text-xs font-medium text-[#1A6B4A]">Abrir hoja →</span>
                    </div>
                  </div>
                  {bloqueo && (
                    <div className="mx-4 mb-2 flex items-start gap-2 bg-[#FFF7E8] border border-[#E8C88A] rounded-lg px-3 py-2">
                      <span className="text-[11px] text-[#6B5418]">{bloqueo}</span>
                    </div>
                  )}
                  {!sinAvance && (
                    <div className="px-4 pb-2">
                      <div className="h-1.5 bg-[#E8EFE9] rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-brand-green transition-all duration-300" style={{ width: `${prog}%` }} />
                      </div>
                    </div>
                  )}
                </Link>
              );
            }

            return (
              <OrdenCaptura
                key={orden.id}
                ordenId={orden.id}
                numero={orden.numero_orden}
                cliente={orden.cliente}
                tipoSaco={orden.tipo_saco}
                cantidad={orden.cantidad}
                linea={orden.linea}
                area={area}
                componentes={av!.componentes}
                prog={prog}
                colorBar={c.text}
                editable={editable && !bloqueo}
                aviso={bloqueo ?? undefined}
                ultimoReporte={av!.ultimoReporte}
                onSet={(idx, val) => setHecho(orden.id, area, idx, val)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function OrdenCaptura({
  numero, cliente, tipoSaco, cantidad, linea, componentes, prog, editable, aviso, ultimoReporte, onSet,
}: {
  ordenId: string; numero: string; cliente: string; tipoSaco: string; cantidad: number;
  linea: 1 | 2 | null; area: Area; componentes: ComponenteProduccion[]; prog: number; colorBar: string;
  editable: boolean;
  aviso?: string;
  ultimoReporte?: { fecha: string; usuario: string | null };
  onSet: (idx: number, val: number) => void;
}) {
  // Contraída por default: el supervisor decide cuál desplegar.
  const [open, setOpen] = useState(false);

  return (
    <div className="bg-white border border-[#E2E5E2] rounded-xl shadow-card overflow-hidden">
      {/* Header de la orden */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-brand-green-50/30 transition-colors text-left"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-[#1A1A1A] font-mono">{numero}</span>
            {linea && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#2A2E2B] text-white">
                LÍNEA {linea}
              </span>
            )}
            {prog >= 100 && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-brand-green-light text-[#047150]">
                ÁREA TERMINADA
              </span>
            )}
          </div>
          <div className="text-xs text-[#6B716C] truncate">
            {cliente} · {tipoSaco} · <span className="font-mono">{cantidad.toLocaleString()}</span> sacos
          </div>
          <div className="text-[10px] text-[#8A9A8C]">
            {ultimoReporte
              ? <>Último reporte: <span className="font-medium text-[#6B716C]">{formatFechaHora(ultimoReporte.fecha)}</span>{ultimoReporte.usuario && <> · {ultimoReporte.usuario}</>}</>
              : 'Sin reportes aún'}
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="text-right">
            <div className="text-lg font-bold text-[#1A1A1A] leading-none">{prog}%</div>
            <div className="text-[10px] text-[#8A9A8C]">avance área</div>
          </div>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className={`transition-transform ${open ? 'rotate-180' : ''}`}>
            <path d="M5 7l4 4 4-4" stroke="#8A9A8C" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </button>

      {/* Aviso de bloqueo (orden pausada / sin autorizar) */}
      {aviso && (
        <div className="mx-4 mb-2 flex items-start gap-2 bg-[#FFF7E8] border border-[#E8C88A] rounded-lg px-3 py-2">
          <svg width="14" height="14" viewBox="0 0 18 18" fill="none" className="flex-shrink-0 mt-0.5">
            <rect x="3.5" y="8" width="11" height="7" rx="1.5" stroke="#9A6A12" strokeWidth="1.5" />
            <path d="M6 8V6a3 3 0 016 0v2" stroke="#9A6A12" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span className="text-[11px] text-[#6B5418]">{aviso}</span>
        </div>
      )}

      {/* Barra de área */}
      <div className="px-4 pb-2">
        <div className="h-1.5 bg-[#E8EFE9] rounded-full overflow-hidden">
          <div className="h-full rounded-full bg-brand-green transition-all duration-300" style={{ width: `${prog}%` }} />
        </div>
      </div>

      {/* Componentes */}
      {open && (
        <div className="border-t border-[#E8EFE9] divide-y divide-[#F0F5F0]">
          {componentes.map((comp, idx) => (
            <ComponenteRow
              key={idx}
              comp={comp}
              editable={editable}
              onSet={(v) => onSet(idx, v)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ComponenteRow({ comp, editable, onSet }: { comp: ComponenteProduccion; editable: boolean; onSet: (v: number) => void }) {
  const p = progresoComponente(comp);
  const completo = comp.hecho >= comp.meta;
  const falta = Math.max(0, comp.meta - comp.hecho);
  const step = comp.meta >= 2000 ? 50 : comp.meta >= 500 ? 10 : 5;

  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-[#1A1A1A] truncate">{comp.nombre}</span>
          {completo && (
            <span className="text-[10px] font-semibold text-[#1A1A1A] bg-brand-green-light px-1.5 py-0.5 rounded flex-shrink-0">
              ✓ Completo
            </span>
          )}
        </div>
        <div className="text-xs text-[#8A9A8C] flex-shrink-0 font-mono">
          {comp.hecho.toLocaleString()} / {comp.meta.toLocaleString()}
        </div>
      </div>

      {/* Barra */}
      <div className="h-2 bg-[#E8EFE9] rounded-full overflow-hidden mb-2">
        <div
          className={`h-full rounded-full transition-all duration-300 ${completo ? 'bg-brand-green' : 'bg-brand-orange'}`}
          style={{ width: `${p}%` }}
        />
      </div>

      {/* Controles */}
      {editable ? (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => onSet(comp.hecho - step)}
            className="w-7 h-7 rounded-md border border-[#E2E5E2] text-[#6B716C] hover:bg-[#F6F8F1] flex items-center justify-center text-sm font-bold disabled:opacity-40"
            disabled={comp.hecho <= 0}
          >−</button>

          <NumeroInput
            valor={comp.hecho}
            max={comp.meta}
            onValor={(v) => onSet(parseInt(v, 10) || 0)}
            className="w-20 px-2 py-1 text-sm text-center border border-[#E2E5E2] rounded-md bg-[#F8FAF8] focus:outline-none focus:ring-1 focus:ring-brand-green focus:border-brand-green font-mono"
          />

          <button
            onClick={() => onSet(comp.hecho + step)}
            className="w-7 h-7 rounded-md border border-[#E2E5E2] text-[#6B716C] hover:bg-[#F6F8F1] flex items-center justify-center text-sm font-bold disabled:opacity-40"
            disabled={completo}
          >+</button>

          <span className="text-[11px] text-[#8A9A8C] mx-1">(+{step})</span>

          {!completo && (
            <>
              <span className="text-[11px] text-[#1A1A1A] font-medium">Faltan {falta.toLocaleString()}</span>
              <button
                onClick={() => onSet(comp.meta)}
                className="ml-auto text-[11px] font-medium text-[#1A1A1A] hover:text-[#1A1A1A] border border-brand-green/30 hover:bg-brand-green-50 rounded-md px-2 py-1 transition-colors"
              >
                Completar todo
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 text-[11px] text-[#8A9A8C]">
          <span className="inline-flex items-center gap-1">
            <svg width="11" height="11" viewBox="0 0 18 18" fill="none">
              <rect x="3.5" y="8" width="11" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M6 8V6a3 3 0 016 0v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            Solo lectura
          </span>
          {!completo && <span>· Faltan {falta.toLocaleString()}</span>}
        </div>
      )}
    </div>
  );
}
