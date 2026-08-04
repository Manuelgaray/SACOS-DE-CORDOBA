'use client';

// ─────────────────────────────────────────────────────────────────────────────
//  HOJAS IMPRIMIBLES — el papel que pide la auditoría.
//
//  Cada formato es una RÉPLICA del preimpreso oficial: mismo membrete, mismos
//  campos en el mismo lugar, mismas columnas y mismo pie con el código del
//  formato. La idea es que un auditor pueda comparar el papel de la carpeta
//  contra el que sale de la app y no encuentre diferencias de disposición.
//
//  Se abre desde el botón "Descargar formato" de cada hoja:
//    /produccion/imprimir?orden=<id>&hoja=<tipo>
//  y "Descargar PDF" lanza la impresión del navegador (Guardar como PDF).
// ─────────────────────────────────────────────────────────────────────────────

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useProduccion } from '@/produccion/produccion-store';
import { useSession } from '@/autenticacion/auth';
import { AREA_LABELS, type Area, type Orden } from '@/compartido/mock-data';
import { agruparMateriales } from '@/produccion/almacen-familia';

// ─── Catálogo de formatos ─────────────────────────────────────────────────────

export type TipoHoja =
  | 'caratula' | 'almacen'
  | 'corte' | 'material' | 'rawbag' | 'verif-rawbag' | 'calidad' | 'defectos' | 'empaque';

interface DefHoja {
  titulo: string;
  codigo: string;        // código del formato, tal cual aparece en el papel
  vertical?: boolean;    // carta vertical en vez de horizontal
  api?: string;          // sin api = todo sale de la orden que ya está en memoria
  // Áreas que capturan este formato. Solo su supervisor (o el admin) puede
  // bajarlo: el mismo criterio que para capturarlo. Sin áreas = cualquiera.
  areas?: Area[];
}

export const HOJAS: Record<TipoHoja, DefHoja> = {
  'caratula': {
    titulo: 'Orden de producción',
    codigo: 'VEN-FOR-005',
    vertical: true,
  },
  'almacen': {
    titulo: 'Formato de salida y entrega de materiales a producción',
    codigo: 'ALM-FOR-001 REV. 3 (04-08-25)',
    api: '/api/hoja-almacen',
    areas: ['almacen'],
  },
  'corte': {
    titulo: 'Verificación de material área de corte',
    codigo: '29-04-14, REV. 3 (25-11-25), PRO-FOR-004',
    api: '/api/hoja-corte',
    areas: ['corte'],
  },
  'material': {
    titulo: 'Control de material',
    codigo: '06-10-14, REV. 1 (16-05-16), PRO-FOR-002',
    api: '/api/hoja-material',
    areas: ['small', 'tips'],
  },
  'rawbag': {
    titulo: 'Reporte de producción de Raw Bag y Tapa',
    codigo: '29-04-14, REV. 1 (12-01-25), PRO-FOR-006',
    api: '/api/hoja-rawbag',
    areas: ['big', 'tapa'],
  },
  'verif-rawbag': {
    titulo: 'Verificación de área de Raw Bag',
    codigo: '29-04-14, REV. 1 (12-01-25), PRO-FOR-005',
    api: '/api/hoja-verif-rawbag',
    areas: ['big'],
  },
  'calidad': {
    titulo: 'Control de mesas de calidad',
    codigo: '08-12-15, REV. 0, PRO-FOR-015',
    api: '/api/hoja-calidad',
    areas: ['calidad'],
  },
  'defectos': {
    titulo: 'Formato de defectos y hallazgos en proceso',
    codigo: '08-03-16, REV. 1, PRO-FOR-016.',
    vertical: true,
    api: '/api/hoja-defectos',
    areas: ['calidad'],
  },
  'empaque': {
    titulo: 'Control de tarimas y sacos en prensa',
    codigo: 'PRO-FOR-007 Rev. 0',
    api: '/api/hoja-empaque',
    areas: ['empaque'],
  },
};

// Columnas de elemento preimpresas en la hoja de corte (van en vertical).
const ELEMENTOS_CORTE = [
  'LATERAL', 'CUERPO', 'INLET', 'FALDÓN', 'OUTLET', 'TAPA',
  'BASE', 'BAFFLE', 'CINTA', 'BANDA', '2do Corte',
];

// Cómo se traduce el elemento capturado a la columna del preimpreso.
const COLUMNA_DE_ELEMENTO: [RegExp, string][] = [
  [/lateral/i, 'LATERAL'],
  [/cuerpo/i, 'CUERPO'],
  [/(valvula|válvula).*carga|inlet/i, 'INLET'],
  [/(faldon|faldón)/i, 'FALDÓN'],
  [/(valvula|válvula).*descarga|outlet/i, 'OUTLET'],
  [/tapa/i, 'TAPA'],
  [/base/i, 'BASE'],
  [/baffle/i, 'BAFFLE'],
  [/cinta/i, 'CINTA'],
  [/(cinturon|cinturón|banda)/i, 'BANDA'],
  [/2do|segundo/i, '2do Corte'],
];

function columnaDeElemento(elemento: string): string | null {
  for (const [re, col] of COLUMNA_DE_ELEMENTO) if (re.test(elemento)) return col;
  return null;
}

// Catálogo del pie de la hoja de defectos, en el mismo orden de tres columnas
// que el preimpreso (se lee por columnas, no por renglones).
const DEFECTOS_COL1 = [
  ['PUNTADA SALTADA', 'PS'], ['MAL EMPALMADO', 'MP'], ['HILO DESFIBRADO', 'HD'],
  ['DESVIACIÓN DE MEDIDAS', 'DM'], ['MANCHAS INTERNAS', 'MI'],
];
const DEFECTOS_COL2 = [
  ['TELA SUCIA', 'TS'], ['CINTAS COSTURADAS', 'CC'], ['TELA CON DEFECTO', 'TD'],
  ['FALTA DE ETIQUETA', 'FE'], ['CONTAMINANTE FÍSICO O QUÍMICO DENTRO', 'CF'],
];
const DEFECTOS_COL3 = [
  ['FALTA DE ACCESORIOS', 'FAC'], ['TELA ROTA', 'TR'],
  ['FALLA EN LINER', 'FL'], ['FALLA EN ANTIFUGA', 'FAN'],
];

// ─── Utilidades ───────────────────────────────────────────────────────────────

function fechaCorta(f: string): string {
  if (!f) return '';
  const [a, m, d] = f.split('-');
  return `${d}/${m}/${a.slice(2)}`;
}

function agruparPorFecha<T extends { fecha: string }>(filas: T[]): [string, T[]][] {
  const m = new Map<string, T[]>();
  for (const f of filas) {
    const lista = m.get(f.fecha) ?? [];
    lista.push(f);
    m.set(f.fecha, lista);
  }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

// Renglones en blanco: el preimpreso siempre trae la hoja completa.
function vacias(cuantas: number, columnas: number) {
  return Array.from({ length: Math.max(0, cuantas) }, (_, i) => (
    <tr key={`v${i}`} className="vacia">
      {Array.from({ length: columnas }, (_, j) => <td key={j}>&nbsp;</td>)}
    </tr>
  ));
}

// ─── Piezas compartidas ───────────────────────────────────────────────────────

function Membrete({ titulo, codigo, suelto }: { titulo: string; codigo?: string; suelto?: boolean }) {
  return (
    <div className={`membrete${suelto ? ' suelto' : ''}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.png" alt="Sacos de Córdoba" />
      <h1>{titulo}</h1>
      <span className="cod">{codigo ?? ''}</span>
    </div>
  );
}

function PieFormato({ codigo, origen }: { codigo: string; origen: string }) {
  return (
    <>
      <div className="codigo-pie">{codigo}</div>
      {/* El rastro de impresión solo se ve en pantalla: el papel debe quedar
          idéntico al formato controlado, sin líneas de más. */}
      <div className="origen no-imprimir"><span>{origen}</span></div>
    </>
  );
}

function ReticulaPapel({ total, max, filas, columnas }: {
  total: number; max: number; filas: number; columnas: number;
}) {
  return (
    <table className="reticula">
      <tbody>
        {Array.from({ length: filas }, (_, r) => (
          <tr key={r}>
            {Array.from({ length: columnas }, (_, c) => {
              const n = 1 + r + filas * c;
              if (n > max) return <td key={c} className="hueco" />;
              return <td key={c} className={n <= total ? 'tachado' : ''}>{n}</td>;
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── Pantalla ─────────────────────────────────────────────────────────────────

export default function ImprimirHojaPage() {
  const { ordenes, ready } = useProduccion();
  const { sesion } = useSession();
  const router = useRouter();

  const [ordenId, setOrdenId] = useState('');
  const [tipo, setTipo] = useState<TipoHoja | ''>('');
  const [paramListo, setParamListo] = useState(false);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    setOrdenId(p.get('orden') ?? '');
    const t = p.get('hoja') ?? '';
    if (t in HOJAS) setTipo(t as TipoHoja);
    setParamListo(true);
  }, []);

  const orden = ordenes.find(o => o.id === ordenId);
  const def = tipo ? HOJAS[tipo] : null;

  // Mismo criterio que la captura: el formato de un área lo baja su supervisor
  // o el admin. Se valida aquí también para que la URL no sea un atajo.
  const permitido =
    !def?.areas ||
    sesion?.rol === 'admin' ||
    (sesion?.rol === 'supervisor' && !!sesion.area_asignada &&
      def.areas.includes(sesion.area_asignada as Area));

  const [datos, setDatos] = useState<Record<string, unknown> | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ordenId || !def || !sesion?.email || !permitido) return;
    // La carátula sale de la propia orden: no hay hoja de captura que cargar.
    if (!def.api) { setDatos({}); setCargando(false); return; }
    let cancelado = false;
    setCargando(true);
    fetch(`${def.api}?orden=${encodeURIComponent(ordenId)}`, { headers: { 'x-user-email': sesion.email } })
      .then(async r => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d?.error ?? 'No se pudo cargar la hoja.');
        return d;
      })
      .then(d => { if (!cancelado) setDatos(d); })
      .catch(e => { if (!cancelado) setError(e.message); })
      .finally(() => { if (!cancelado) setCargando(false); });
    return () => { cancelado = true; };
  }, [ordenId, def, sesion?.email, permitido]);

  const origen = useMemo(() => {
    const ahora = new Date().toLocaleString('es-MX', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    return `Impreso desde SuperSacos Pro · ${ahora} · ${sesion?.nombre ?? ''}`;
  }, [sesion?.nombre]);

  const imprimir = useCallback(() => window.print(), []);

  if (!ready || !paramListo) return <div className="p-6 text-sm text-[#6B716C]">Cargando…</div>;

  if (!def || !orden) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="bg-white border border-[#E2E5E2] rounded-xl p-8 text-center shadow-card">
          <p className="text-sm text-[#6B716C] mb-4">
            Falta indicar la orden o el formato a imprimir. Entra desde el botón
            &ldquo;Descargar formato&rdquo; de la hoja del área.
          </p>
          <Link
            href="/produccion"
            className="inline-flex text-sm font-semibold text-white bg-brand-green hover:bg-brand-green-dark rounded-lg px-4 py-2 transition-colors"
          >
            Ir a Producción
          </Link>
        </div>
      </div>
    );
  }

  if (!permitido) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="bg-white border border-[#E2E5E2] rounded-xl p-8 text-center shadow-card">
          <div className="w-12 h-12 rounded-full bg-[#FFF7E8] border border-[#E8C88A] flex items-center justify-center mx-auto mb-4">
            <svg width="22" height="22" viewBox="0 0 18 18" fill="none">
              <rect x="3.5" y="8" width="11" height="7" rx="1.5" stroke="#9A6A12" strokeWidth="1.5" />
              <path d="M6 8V6a3 3 0 016 0v2" stroke="#9A6A12" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
          <h2 className="text-base font-semibold text-[#1A1A1A] mb-1">Formato restringido</h2>
          <p className="text-sm text-[#6B716C] mb-4">
            El formato <span className="font-semibold">{def.titulo}</span> lo descarga el supervisor
            de {def.areas!.map(a => AREA_LABELS[a]).join(' o ')} (o un administrador).
          </p>
          <button
            onClick={() => router.back()}
            className="inline-flex text-sm font-semibold text-white bg-brand-green hover:bg-brand-green-dark rounded-lg px-4 py-2 transition-colors"
          >
            Regresar
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* La orientación del papel depende del formato. */}
      <style>{`@page { size: letter ${def.vertical ? 'portrait' : 'landscape'}; margin: 8mm; }`}</style>

      <div className="no-imprimir sticky top-0 z-10 bg-white border-b border-[#E2E5E2] px-4 lg:px-6 py-3 flex items-center gap-3 flex-wrap">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-sm text-[#6B716C] hover:text-[#1A1A1A] transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Regresar
        </button>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-[#1A1A1A] truncate">{def.titulo}</div>
          <div className="text-[11px] text-[#8A9A8C] truncate">
            <span className="font-mono">{def.codigo}</span> · orden{' '}
            <span className="font-mono">{orden.numero_orden}</span> · carta{' '}
            {def.vertical ? 'vertical' : 'horizontal'}
          </div>
        </div>
        <button
          onClick={imprimir}
          disabled={cargando || !!error}
          className="ml-auto text-xs font-semibold text-white bg-brand-green hover:bg-brand-green-dark rounded-lg px-4 py-2.5 transition-colors disabled:opacity-40"
        >
          Descargar PDF / Imprimir
        </button>
      </div>

      {!cargando && !error && (
        <p className="no-imprimir px-4 lg:px-6 pt-3 text-[11px] text-[#8A9A8C] max-w-3xl">
          En el diálogo del navegador elige <span className="font-semibold">Guardar como PDF</span> y
          deja los márgenes en <span className="font-semibold">Predeterminado</span>. Cada hoja del
          formato sale en su propia página, y la orientación ya viene fijada.
        </p>
      )}

      <div className="bg-[#E9ECE6] print:bg-white py-6 print:py-0 px-2 print:px-0 overflow-x-auto">
        {cargando && <p className="text-center text-sm text-[#6B716C] py-10">Preparando el formato…</p>}
        {error && <p className="text-center text-sm text-red-700 py-10">{error}</p>}
        {!cargando && !error && datos && (
          <div className="papel">
            <Cuerpo tipo={tipo as TipoHoja} def={def} orden={orden} datos={datos} origen={origen} />
          </div>
        )}
      </div>
    </>
  );
}

interface Props {
  def: DefHoja; orden: Orden; datos: Record<string, unknown>; origen: string;
}

function Cuerpo(props: Props & { tipo: TipoHoja }) {
  switch (props.tipo) {
    case 'caratula':     return <HojaCaratula {...props} />;
    case 'almacen':      return <HojaAlmacen {...props} />;
    case 'corte':        return <HojaCorte {...props} />;
    case 'material':     return <HojaMaterial {...props} />;
    case 'rawbag':       return <HojaRawbag {...props} />;
    case 'verif-rawbag': return <HojaVerif {...props} />;
    case 'calidad':      return <HojaCalidad {...props} />;
    case 'defectos':     return <HojaDefectos {...props} />;
    case 'empaque':      return <HojaEmpaque {...props} />;
  }
}

function SinDatos({ def, origen, texto }: { def: DefHoja; origen: string; texto: string }) {
  return (
    <section className={`hoja ${def.vertical ? 'hoja-v' : ''}`}>
      <div className="marco">
        <Membrete titulo={def.titulo} codigo={def.codigo} />
        <p style={{ fontSize: '8pt', padding: '15mm 0', textAlign: 'center' }}>{texto}</p>
      </div>
      <PieFormato codigo={def.codigo} origen={origen} />
    </section>
  );
}

// ─── CARÁTULA · Orden de producción (VEN-FOR-005) ─────────────────────────────
// Es la portada que acompaña a la orden en planta. Sale directo de la orden.

function fechaLarga(valor: string | null | undefined): string {
  if (!valor) return '';
  // 'YYYY-MM-DD' se parte a mano: new Date('2026-07-15') es medianoche UTC y
  // en México saldría el día anterior. En un documento oficial eso no puede pasar.
  const m = valor.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function HojaCaratula({ def, orden, origen }: Props) {
  return (
    <section className="hoja hoja-v" style={{ padding: '6mm 8mm' }}>
      {/* Control del documento */}
      <table className="cab-control">
        <tbody>
          <tr>
            <td><b>Código</b>{def.codigo}</td>
            <td><b>Fecha de Elaboración</b>20/01/2017</td>
            <td><b>Revisión</b>0</td>
            <td><b>Fecha de Revisión</b>&nbsp;</td>
          </tr>
        </tbody>
      </table>

      {/* Número de orden + logo */}
      <div className="caratula-titulo">
        <div className="textos">
          <div className="no">No.&nbsp;&nbsp;{orden.numero_orden}</div>
          <div className="tipo">Orden de produccion</div>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="Sacos de Córdoba" />
      </div>

      {/* Campos de la carátula, en el orden del preimpreso */}
      <table className="caratula-campos">
        <tbody>
          <tr><td className="et">Cliente:</td><td className="val">{orden.cliente}</td></tr>
          <tr><td className="et">Spec:</td><td className="val">{orden.spec}</td></tr>
          <tr><td className="et">Medida:</td><td className="val">{orden.medida}</td></tr>
          <tr><td className="et">Cantidad:</td><td className="val">{orden.cantidad.toLocaleString()} PIEZAS</td></tr>
          <tr><td className="et">Carga:</td><td className="val">{orden.carga_lbs.toLocaleString()} Lbs</td></tr>
          <tr><td className="et">FMF:</td><td className="val">{fechaLarga(orden.fecha_entrega)}</td></tr>
          <tr><td className="et">Tipo de saco:</td><td className="val">{orden.tipo_saco}</td></tr>
          <tr><td className="et">No. Orden Cliente:</td><td className="val">{orden.orden_cliente ?? ''}</td></tr>
        </tbody>
      </table>

      <div className="caratula-embarcar">
        Embarcar a:
        <span>{orden.embarcar_a ?? ''}</span>
      </div>

      <div style={{ marginTop: 'auto' }}>
        <div className="origen no-imprimir"><span>{origen}</span></div>
      </div>
    </section>
  );
}

// ─── ALMACÉN · Salida y entrega de materiales (ALM-FOR-001) ───────────────────

interface MaterialAlmP {
  id: number; material: string; etiqueta: string; factura: string;
  tag: string; cantidad: number; unidad: string;
}
interface ConsumoAlmP { familia: string; consumo_esperado: number; devolucion_real: number }
interface EntregaAlmP {
  id: number; fecha: string; cantidad_entregada: number;
  firma_entrega: string; firma_recepcion_corte: string; firma_recepcion_prod: string;
  firma_recepcion_alm: string; firma_entrega_corte: string;
  materiales: MaterialAlmP[];
  consumos: ConsumoAlmP[];
}

const num = (n: number) => (n ? n.toLocaleString('es-MX', { maximumFractionDigits: 2 }) : '');

function HojaAlmacen({ def, orden, datos, origen }: Props) {
  const entregas = (datos.hojas ?? []) as EntregaAlmP[];
  if (entregas.length === 0) return <SinDatos def={def} origen={origen} texto="Sin entregas de material capturadas en esta orden." />;

  // La "cantidad restante" es contra el acumulado hasta esa entrega.
  let acumulado = 0;

  return (
    <>
      {entregas.map(h => {
        acumulado += h.cantidad_entregada;
        const restante = Math.max(0, orden.cantidad - acumulado);
        return (
          <section className="hoja" key={h.id}>
            <div className="marco">
              <Membrete titulo="Formato de salida y entrega de materiales a producción" codigo={def.codigo} />

              <table className="campos">
                <tbody>
                  <tr>
                    <td className="et">Fecha:</td><td className="val">{fechaCorta(h.fecha)}</td>
                    <td className="et">Cliente:</td><td className="val">{orden.cliente}</td>
                    <td className="et">Cantidad real entregada</td><td className="val">{num(h.cantidad_entregada)}</td>
                  </tr>
                  <tr>
                    <td className="et">Orden:</td><td className="val">{orden.numero_orden}</td>
                    <td className="et">Cantidad total</td><td className="val">{orden.cantidad.toLocaleString()}</td>
                    <td className="et">Cantidad restante:</td><td className="val">{restante.toLocaleString()}</td>
                  </tr>
                </tbody>
              </table>

              <table className="datos">
                <colgroup>
                  <col style={{ width: '3%' }} /><col style={{ width: '17%' }} />
                  <col style={{ width: '14%' }} /><col style={{ width: '9%' }} />
                  <col style={{ width: '9%' }} /><col style={{ width: '9%' }} />
                  <col style={{ width: '7%' }} /><col style={{ width: '10%' }} />
                  <col style={{ width: '11%' }} /><col style={{ width: '11%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th rowSpan={2}>#</th>
                    <th rowSpan={2}>Material</th>
                    <th rowSpan={2}>No. Etiqueta</th>
                    <th rowSpan={2}>Factura</th>
                    <th rowSpan={2}>Tag</th>
                    <th rowSpan={2}>Cantidad entregada</th>
                    <th rowSpan={2}>Unidad de medida</th>
                    <th rowSpan={2}>Consumo esperado</th>
                    <th colSpan={2} className="dev-ini">Devolución de materiales</th>
                  </tr>
                  <tr>
                    <th className="dev-ini">Devolución esperada</th>
                    <th>Devolución real.</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    // Mismo agrupado que en la captura: el renglón sombreado es
                    // la familia y su cantidad es la suma de sus rollos.
                    const grupos = agruparMateriales(h.materiales);
                    const consumoDe = (f: string) =>
                      h.consumos.find(c => c.familia === f) ?? { familia: f, consumo_esperado: 0, devolucion_real: 0 };
                    const filas: React.ReactNode[] = [];
                    let i = 0;

                    for (const g of grupos) {
                      const c = consumoDe(g.clave);
                      const devol = c.consumo_esperado > 0
                        ? num(Math.max(0, g.total - c.consumo_esperado)) : '';

                      if (g.esFamilia) {
                        i += 1;
                        filas.push(
                          <tr key={`f-${g.clave}`} style={{ background: '#E6E6E6' }}>
                            <td>{i}</td>
                            <td className="izq" style={{ fontWeight: 700 }}>{g.clave}</td>
                            <td>-------------</td><td>-------------</td><td>----------</td>
                            <td>{num(g.total)}</td>
                            <td>------</td>
                            <td>{c.consumo_esperado > 0 ? num(c.consumo_esperado) : ''}</td>
                            <td className="dev-ini">{devol}</td>
                            <td>{num(c.devolucion_real)}</td>
                          </tr>,
                        );
                      }

                      for (const m of g.renglones) {
                        i += 1;
                        filas.push(
                          <tr key={m.id}>
                            <td>{i}</td>
                            <td className="izq">{m.material}</td>
                            <td>{m.etiqueta}</td><td>{m.factura}</td><td>{m.tag}</td>
                            <td>{num(m.cantidad)}</td>
                            <td>{m.unidad}</td>
                            {/* En los rollos de una familia el papel deja vacío. */}
                            <td>{g.esFamilia ? '' : (c.consumo_esperado > 0 ? num(c.consumo_esperado) : '-----------')}</td>
                            <td className="dev-ini">{g.esFamilia ? '' : devol}</td>
                            <td>{g.esFamilia ? '' : num(c.devolucion_real)}</td>
                          </tr>,
                        );
                      }
                    }
                    // Renglones en blanco, conservando la línea gruesa del bloque.
                    for (let k = i; k < 20; k++) {
                      filas.push(
                        <tr key={`v${k}`} className="vacia">
                          {Array.from({ length: 10 }, (_, c) => (
                            <td key={c} className={c === 8 ? 'dev-ini' : undefined}>&nbsp;</td>
                          ))}
                        </tr>,
                      );
                    }
                    return filas;
                  })()}
                </tbody>
              </table>

              {/* Las firmas caen bajo SUS columnas: las tres de la izquierda
                  corresponden a la entrega, y las dos de la derecha van dentro
                  del bloque de Devolución de materiales. Mismo colgroup que la
                  tabla de arriba para que las divisiones coincidan. */}
              <table className="datos" style={{ marginTop: 'auto' }}>
                <colgroup>
                  <col style={{ width: '3%' }} /><col style={{ width: '17%' }} />
                  <col style={{ width: '14%' }} /><col style={{ width: '9%' }} />
                  <col style={{ width: '9%' }} /><col style={{ width: '9%' }} />
                  <col style={{ width: '7%' }} /><col style={{ width: '10%' }} />
                  <col style={{ width: '11%' }} /><col style={{ width: '11%' }} />
                </colgroup>
                <tbody>
                  <tr>
                    <td colSpan={3} style={{ height: '10mm', verticalAlign: 'bottom' }}>{h.firma_entrega}</td>
                    <td colSpan={2} style={{ verticalAlign: 'bottom' }}>{h.firma_recepcion_corte}</td>
                    <td colSpan={3} style={{ verticalAlign: 'bottom' }}>{h.firma_recepcion_prod}</td>
                    <td className="dev-ini" style={{ verticalAlign: 'bottom' }}>{h.firma_recepcion_alm}</td>
                    <td style={{ verticalAlign: 'bottom' }}>{h.firma_entrega_corte}</td>
                  </tr>
                  <tr style={{ fontSize: '5.5pt' }}>
                    <td className="izq" colSpan={3}>Firma entrega almacén.</td>
                    <td className="izq" colSpan={2}>Firma recepción Corte.</td>
                    <td className="izq" colSpan={3}>Firma recepción producción.</td>
                    <td className="izq dev-ini">Firma recepción almacén</td>
                    <td className="izq">Firma entrega corte</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <PieFormato codigo={def.codigo} origen={origen} />
          </section>
        );
      })}
    </>
  );
}

// ─── CORTE · Verificación de material área de corte (PRO-FOR-004) ─────────────

interface RenglonCorte {
  id: number; fecha: string; operador: string; maquina: string; hora: string; rollo: string;
  elemento: string; medidaSpec: string; medidaReal: string; materialSpec: string;
  materialReal: string; laminado: boolean; diamSpec: string; diamReal: string;
  piezas: number; firma: string; pc: boolean;
}

function HojaCorte({ def, orden, datos, origen }: Props) {
  const renglones = (datos.renglones ?? []) as RenglonCorte[];
  const dias = agruparPorFecha(renglones);
  if (dias.length === 0) return <SinDatos def={def} origen={origen} texto="Sin cortes capturados en esta orden." />;

  const TOTAL_COLS = 4 + ELEMENTOS_CORTE.length + 2 + 2 + 1 + 2 + 2 + 1; // 25

  return (
    <>
      {dias.map(([fecha, filas]) => {
        // Elementos capturados que no tienen columna en el preimpreso: se
        // anotan en COMENTARIOS para no perder el dato ni falsear el formato.
        const sinColumna = [...new Set(
          filas.map(r => r.elemento).filter(e => e.trim() && !columnaDeElemento(e)),
        )];

        return (
          <section className="hoja" key={fecha}>
            <div className="marco">
              <Membrete titulo="Verificación de material área de corte" />

              <table className="campos">
                <tbody>
                  <tr>
                    <td className="et">Supervisor:</td>
                    <td className="val">{orden.elaborado_por ?? ''}</td>
                    <td className="et"># Orden de trabajo:</td>
                    <td className="val">{orden.numero_orden}</td>
                    <td className="et">Cliente:</td>
                    <td className="val">{orden.cliente}</td>
                    <td className="et">Fecha:</td>
                    <td className="val">{fechaCorta(fecha)}</td>
                  </tr>
                </tbody>
              </table>

              <table className="datos">
                <colgroup>
                  <col style={{ width: '8%' }} />
                  <col style={{ width: '2.6%' }} />
                  <col style={{ width: '3.6%' }} />
                  <col style={{ width: '7%' }} />
                  {ELEMENTOS_CORTE.map(e => <col key={e} style={{ width: '2.1%' }} />)}
                  <col style={{ width: '7%' }} /><col style={{ width: '7%' }} />
                  <col style={{ width: '5.5%' }} /><col style={{ width: '5.5%' }} />
                  <col style={{ width: '2.6%' }} />
                  <col style={{ width: '4.2%' }} /><col style={{ width: '4.2%' }} />
                  <col style={{ width: '4.5%' }} /><col style={{ width: '7.5%' }} />
                  <col style={{ width: '2.6%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th rowSpan={2}>Nombre del operador</th>
                    <th rowSpan={2} className="vert"><span># de máquina</span></th>
                    <th rowSpan={2}>Hora</th>
                    <th rowSpan={2}># de rollo</th>
                    {ELEMENTOS_CORTE.map(e => (
                      <th key={e} rowSpan={2} className="vert"><span>{e}</span></th>
                    ))}
                    <th colSpan={2}>Medidas</th>
                    <th colSpan={2}>Material</th>
                    <th rowSpan={2} className="vert"><span>Verificación de laminado</span></th>
                    <th colSpan={2}>Diámetro</th>
                    <th colSpan={2}>Productividad</th>
                    <th rowSpan={2}>PC</th>
                  </tr>
                  <tr>
                    <th>Especificación</th><th>Real</th>
                    <th>Especificación</th><th>Real</th>
                    <th>Especificación</th><th>Real</th>
                    <th>Piezas cortadas</th><th>Firma del trabajador</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map(r => {
                    const col = columnaDeElemento(r.elemento);
                    return (
                      <tr key={r.id}>
                        <td className="izq">{r.operador}</td>
                        <td>{r.maquina}</td>
                        <td>{r.hora}</td>
                        <td>{r.rollo}</td>
                        {ELEMENTOS_CORTE.map(e => <td key={e}>{col === e ? '/' : ''}</td>)}
                        <td>{r.medidaSpec}</td><td>{r.medidaReal}</td>
                        <td>{r.materialSpec}</td><td>{r.materialReal}</td>
                        <td>{r.laminado ? '/' : ''}</td>
                        <td>{r.diamSpec}</td><td>{r.diamReal}</td>
                        <td>{r.piezas || ''}</td>
                        <td className="izq">{r.firma}</td>
                        <td>{r.pc ? '/' : ''}</td>
                      </tr>
                    );
                  })}
                  {vacias(18 - filas.length, TOTAL_COLS)}
                </tbody>
              </table>

              <div className="nota-pie" style={{ marginTop: 'auto' }}>
                <p>
                  **PC: Verificación de contaminación dentro del contenedor: metal, cartón, hilos o madera.
                </p>
                <p style={{ marginTop: '1.5mm' }}>
                  COMENTARIOS: {sinColumna.length > 0
                    ? `Elementos sin columna en el formato — ${sinColumna.join(', ')}.`
                    : ''}
                </p>
                <div className="linea-larga" />
                <p style={{ marginTop: '2mm' }}>Firma del supervisor: ______________________________</p>
              </div>
            </div>
            <PieFormato codigo={def.codigo} origen={origen} />
          </section>
        );
      })}
    </>
  );
}

// ─── SMALL · TIPS · Control de material (PRO-FOR-002) ─────────────────────────

interface FilaMat { id: number; descripcion: string; entregas: Record<string, number>; terminado: boolean }
interface ColFecha { fecha: string; entrega: string; recibe: string }

// El preimpreso trae SIEMPRE seis columnas de fecha.
const COLS_FECHA_MATERIAL = 6;

function HojaMaterial({ def, orden, datos, origen }: Props) {
  const renglones = (datos.renglones ?? []) as FilaMat[];
  const fechas = (datos.fechas ?? []) as ColFecha[];
  if (renglones.length === 0) return <SinDatos def={def} origen={origen} texto="Sin materiales capturados en esta orden." />;

  // Se imprimen de seis en seis, como el papel.
  const bloques: ColFecha[][] = [];
  for (let i = 0; i < Math.max(1, fechas.length); i += COLS_FECHA_MATERIAL) {
    bloques.push(fechas.slice(i, i + COLS_FECHA_MATERIAL));
  }
  const totalDe = (r: FilaMat) => Object.values(r.entregas ?? {}).reduce((s, n) => s + Number(n || 0), 0);

  return (
    <>
      {bloques.map((bloque, bi) => {
        const cols = Array.from({ length: COLS_FECHA_MATERIAL }, (_, i) => bloque[i] ?? null);
        return (
          <section className="hoja" key={bi}>
            <div className="marco">
              <Membrete titulo="Control de material" />

              <table className="campos">
                <tbody>
                  <tr>
                    <td className="et">Cliente:</td><td className="val">{orden.cliente}</td>
                    <td className="et">Número de orden:</td><td className="val">{orden.numero_orden}</td>
                    <td className="et">Cantidad:</td><td className="val">{orden.cantidad.toLocaleString()} pz</td>
                    <td className="et">Tipo de saco:</td><td className="val">{orden.tipo_saco}</td>
                  </tr>
                </tbody>
              </table>

              <table className="datos">
                <colgroup>
                  <col style={{ width: '28%' }} />
                  {cols.map((_, i) => <col key={i} style={{ width: '10%' }} />)}
                  <col style={{ width: '12%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th className="izq" style={{ textAlign: 'right' }}>Fechas:</th>
                    {cols.map((c, i) => <th key={i}>{c ? fechaCorta(c.fecha) : ''}</th>)}
                    <th rowSpan={2}>Total</th>
                  </tr>
                  <tr>
                    <th className="izq">Descripción del material:</th>
                    {cols.map((_, i) => <th key={i}># de piezas entregada</th>)}
                  </tr>
                </thead>
                <tbody>
                  {renglones.map(r => (
                    <tr key={r.id}>
                      <td className="izq">{r.descripcion}</td>
                      {cols.map((c, i) => <td key={i}>{c ? (r.entregas?.[c.fecha] || '') : ''}</td>)}
                      <td>{totalDe(r) || ''}</td>
                    </tr>
                  ))}
                  {vacias(13 - renglones.length, COLS_FECHA_MATERIAL + 2)}
                  <tr>
                    <td className="izq">Nombre y Firma de quien entrega:</td>
                    {cols.map((c, i) => <td key={i} className="libre">{c?.entrega ?? ''}</td>)}
                    <td />
                  </tr>
                  <tr>
                    <td className="izq">Nombre / firma de quien recibe:</td>
                    {cols.map((c, i) => <td key={i} className="libre">{c?.recibe ?? ''}</td>)}
                    <td />
                  </tr>
                  <tr>
                    <td className="izq libre" colSpan={COLS_FECHA_MATERIAL + 2}>COMENTARIOS:</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <PieFormato codigo={def.codigo} origen={origen} />
          </section>
        );
      })}
    </>
  );
}

// ─── BIG · TAPA · Reporte de producción de Raw Bag y Tapa (PRO-FOR-006) ───────

interface RenglonRB {
  id: number; fecha: string; maquina: string; operador: string; actividad: string;
  p08: number; p10: number; p12: number; p14: number; observaciones: string;
}

function HojaRawbag({ def, orden, datos, origen }: Props) {
  const renglones = (datos.renglones ?? []) as RenglonRB[];
  const dias = agruparPorFecha(renglones);
  if (dias.length === 0) return <SinDatos def={def} origen={origen} texto="Sin producción capturada en esta orden." />;

  const total = (r: RenglonRB) => r.p08 + r.p10 + r.p12 + r.p14;

  return (
    <>
      {dias.map(([fecha, filas]) => (
        <section className="hoja" key={fecha}>
          <div className="marco">
            <Membrete titulo="Reporte de producción de Raw Bag y Tapa" />

            <table className="datos">
              <colgroup>
                <col style={{ width: '8%' }} /><col style={{ width: '18%' }} />
                <col style={{ width: '16%' }} />
                <col style={{ width: '7%' }} /><col style={{ width: '7%' }} />
                <col style={{ width: '7%' }} /><col style={{ width: '7%' }} />
                <col style={{ width: '8%' }} /><col style={{ width: '22%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>N° de maquina</th>
                  <th>Operador</th>
                  <th>Actividad realizada</th>
                  <th>08:00</th><th>10:00</th><th>12:00</th><th>14:00</th>
                  <th>TOTAL</th>
                  <th>OBSERVACIONES</th>
                </tr>
              </thead>
              <tbody>
                {filas.map(r => (
                  <tr key={r.id}>
                    <td>{r.maquina}</td>
                    <td className="izq">{r.operador}</td>
                    <td className="izq">{r.actividad}</td>
                    <td>{r.p08 || ''}</td><td>{r.p10 || ''}</td>
                    <td>{r.p12 || ''}</td><td>{r.p14 || ''}</td>
                    <td>{total(r) || ''}</td>
                    <td className="izq">{r.observaciones}</td>
                  </tr>
                ))}
                {vacias(18 - filas.length, 9)}
              </tbody>
            </table>

            {/* En este formato los datos de la orden van AL PIE, no arriba. */}
            <table className="campos" style={{ marginTop: 'auto' }}>
              <tbody>
                <tr>
                  <td className="et">Fecha:</td>
                  <td className="val">{fechaCorta(fecha)}</td>
                  <td className="et">Estilo del saco:</td>
                  <td className="val">{orden.tipo_saco}</td>
                  <td className="et">Total de piezas:</td>
                  <td className="val">{filas.reduce((s, r) => s + total(r), 0)}</td>
                </tr>
                <tr>
                  <td className="et">Medidas:</td>
                  <td className="val">{orden.medida}</td>
                  <td className="et"># Orden de trabajo:</td>
                  <td className="val" colSpan={3}>{orden.numero_orden} &nbsp; {orden.cliente}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <PieFormato codigo={def.codigo} origen={origen} />
        </section>
      ))}
    </>
  );
}

// ─── BIG · Verificación de área de Raw Bag (PRO-FOR-005) ──────────────────────

type RenglonVerif = Record<string, string | boolean | number> & { id: number; fecha: string };

function HojaVerif({ def, orden, datos, origen }: Props) {
  const renglones = (datos.renglones ?? []) as RenglonVerif[];
  const dias = agruparPorFecha(renglones);
  if (dias.length === 0) return <SinDatos def={def} origen={origen} texto="Sin verificaciones capturadas en esta orden." />;

  const s = (r: RenglonVerif, k: string) => String(r[k] ?? '');
  const x = (r: RenglonVerif, k: string) => (r[k] ? 'X' : '');

  return (
    <>
      {dias.map(([fecha, filas]) => (
        <section className="hoja" key={fecha}>
          <div className="marco">
            <Membrete titulo="Verificación de área de Raw Bag" />

            <table className="campos">
              <tbody>
                <tr>
                  <td className="et"># de orden:</td><td className="val">{orden.numero_orden}</td>
                  <td className="et">Cliente:</td><td className="val">{orden.cliente}</td>
                  <td className="et">Fecha:</td><td className="val">{fechaCorta(fecha)}</td>
                  <td className="et">Supervisor:</td><td className="val" style={{ minWidth: '30mm' }} />
                </tr>
              </tbody>
            </table>

            <table className="datos" style={{ fontSize: '6pt' }}>
              <colgroup>
                <col style={{ width: '8%' }} /><col style={{ width: '4%' }} />
                <col style={{ width: '4.5%' }} /><col style={{ width: '5%' }} />
                <col style={{ width: '9%' }} /><col style={{ width: '9%' }} />
                {Array.from({ length: 8 }, (_, i) => <col key={i} style={{ width: '4%' }} />)}
                <col style={{ width: '4.5%' }} /><col style={{ width: '4.5%' }} />
                <col style={{ width: '4.5%' }} /><col style={{ width: '4.5%' }} />
                <col style={{ width: '2.6%' }} /><col style={{ width: '2.6%' }} />
                <col style={{ width: '2.6%' }} /><col style={{ width: '2.6%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th rowSpan={3}>Nombre del operador</th>
                  <th rowSpan={3}>Hora</th>
                  <th rowSpan={3}>Puntadas por pulgada</th>
                  <th rowSpan={3}>Hilos utilizados (indicar denier)</th>
                  <th colSpan={2}>Medidas del saco</th>
                  <th colSpan={8}>Loops</th>
                  <th colSpan={2}>Diámetro V.D</th>
                  <th colSpan={2}>Material</th>
                  <th colSpan={2}>Filler</th>
                  <th rowSpan={3}>Folt</th>
                  <th rowSpan={3}>** PC</th>
                </tr>
                <tr>
                  <th rowSpan={2}>Especificación</th><th rowSpan={2}>Real</th>
                  <th colSpan={4}>Especificación</th><th colSpan={4}>Real</th>
                  <th rowSpan={2}>Especificación</th><th rowSpan={2}>Real</th>
                  <th rowSpan={2}>Especificación</th><th rowSpan={2}>Real</th>
                  <th rowSpan={2}>1</th><th rowSpan={2}>2</th>
                </tr>
                <tr>
                  {Array.from({ length: 2 }, (_, i) => (
                    <Fragment key={i}>
                      <th>Libre</th><th>Traslape</th><th>Costurado</th><th>Color</th>
                    </Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filas.map(r => (
                  <tr key={r.id}>
                    <td className="izq">{s(r, 'operador')}</td>
                    <td>{s(r, 'hora')}</td><td>{s(r, 'puntadas')}</td><td>{s(r, 'hilos')}</td>
                    <td>{s(r, 'medida_spec')}</td><td>{s(r, 'medida_real')}</td>
                    <td>{s(r, 'loop_libre_spec')}</td><td>{s(r, 'loop_traslape_spec')}</td>
                    <td>{s(r, 'loop_costurado_spec')}</td><td>{s(r, 'loop_color_spec')}</td>
                    <td>{s(r, 'loop_libre_real')}</td><td>{s(r, 'loop_traslape_real')}</td>
                    <td>{s(r, 'loop_costurado_real')}</td><td>{s(r, 'loop_color_real')}</td>
                    <td>{s(r, 'diam_spec')}</td><td>{s(r, 'diam_real')}</td>
                    <td>{s(r, 'material_spec')}</td><td>{s(r, 'material_real')}</td>
                    <td>{x(r, 'filler1')}</td><td>{x(r, 'filler2')}</td>
                    <td>{x(r, 'folt')}</td><td>{x(r, 'pc')}</td>
                  </tr>
                ))}
                {vacias(16 - filas.length, 22)}
                <tr>
                  <td className="izq libre" colSpan={22}>OBSERVACIONES:</td>
                </tr>
                <tr className="vacia">{Array.from({ length: 22 }, (_, i) => <td key={i}>&nbsp;</td>)}</tr>
              </tbody>
            </table>

            <div className="nota-pie" style={{ marginTop: 'auto' }}>
              <p>
                Filler = indicar con una &ldquo;X&rdquo; 1 o 2 dependiendo de si lleva en ambos lados
                así como Folt, si no lleva ese aditamento cancelar las celdas.
              </p>
              <p>
                ** PCC = Verificación ausencia contaminación dentro del contenedor: metal, cartón,
                hilos o madera.
              </p>
              <p style={{ textAlign: 'right', marginTop: '2mm' }}>
                FIRMA DEL SUPERVISOR: ______________________________
              </p>
            </div>
          </div>
          <PieFormato codigo={def.codigo} origen={origen} />
        </section>
      ))}
    </>
  );
}

// ─── CALIDAD · Control de mesas de calidad (PRO-FOR-015) ──────────────────────

interface MesaP { op1: string; op2: string; activa: boolean; total: number }
interface HojaCal {
  id: number; fecha: string; turno: string; supervisor: string; observaciones: string; mesas: MesaP[];
}

function HojaCalidad({ def, orden, datos, origen }: Props) {
  const hojas = (datos.hojas ?? []) as HojaCal[];
  if (hojas.length === 0) return <SinDatos def={def} origen={origen} texto="Sin hojas de mesas capturadas en esta orden." />;

  return (
    <>
      {hojas.map(h => {
        const gran = h.mesas.reduce((s, m) => s + (m.activa ? m.total : 0), 0);
        return (
          // Este formato NO va enmarcado: son campos con línea, como el papel.
          <section className="hoja" key={h.id} style={{ padding: '4mm 6mm' }}>
            <Membrete titulo="Control de mesas de calidad" suelto />

            <div className="linea-campos">
              <span>Orden: <span className="blanco">{orden.numero_orden}</span></span>
              <span>Cliente: <span className="blanco">{orden.cliente}</span></span>
              <span>Cantidad: <span className="blanco" style={{ minWidth: '20mm' }}>{orden.cantidad.toLocaleString()}</span></span>
              <span>Fecha: <span className="blanco" style={{ minWidth: '22mm' }}>{fechaCorta(h.fecha)}</span></span>
            </div>

            <div style={{ display: 'flex', gap: '6mm', marginTop: '4mm' }}>
              {h.mesas.map((m, i) => (
                <div key={i} style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '8.5pt', fontWeight: 700, textTransform: 'uppercase', marginBottom: '1.5mm' }}>
                    Mesa #{i + 1}
                    <span className="blanco" style={{ minWidth: '32mm', fontWeight: 400, textTransform: 'none' }}>
                      {[m.op1, m.op2].filter(Boolean).join(' — ')}
                    </span>
                  </div>
                  <div className="reticula-marco">
                    <ReticulaPapel total={m.activa ? m.total : 0} max={175} filas={25} columnas={7} />
                  </div>
                  <div style={{ fontSize: '8.5pt', fontWeight: 700, textTransform: 'uppercase', marginTop: '2mm' }}>
                    Total mesa # {i + 1}:
                    <span className="blanco" style={{ minWidth: '18mm', fontWeight: 400 }}>
                      {m.activa ? m.total : ''}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <div className="linea-campos" style={{ marginTop: '4mm' }}>
              <span>Gran total mesas: <span className="blanco" style={{ minWidth: '24mm' }}>{gran}</span></span>
              <span>Supervisor: <span className="blanco" style={{ minWidth: '42mm', fontWeight: 400 }}>{h.supervisor}</span></span>
              <span>Turno: <span className="blanco" style={{ minWidth: '20mm', fontWeight: 400 }}>{h.turno}</span></span>
            </div>

            <div style={{ marginTop: '3mm', fontSize: '8.5pt', fontWeight: 700, textTransform: 'uppercase' }}>
              Observaciones:
              <span className="blanco" style={{ minWidth: '150mm', fontWeight: 400, textTransform: 'none' }}>
                {h.observaciones}
              </span>
            </div>
            <div className="linea-larga" />
            <div className="linea-larga" />

            <div style={{ marginTop: 'auto' }}>
              <PieFormato codigo={def.codigo} origen={origen} />
            </div>
          </section>
        );
      })}
    </>
  );
}

// ─── CALIDAD · Defectos y hallazgos en proceso (PRO-FOR-016) ──────────────────

interface RenglonDef {
  id: number; fecha: string; turno: string; mesa: string; etiqueta: string;
  maquina: string; operador: string; defecto: string; resultado: string;
}

function HojaDefectos({ def, orden, datos, origen }: Props) {
  const renglones = (datos.renglones ?? []) as RenglonDef[];
  const dias = agruparPorFecha(renglones);
  if (dias.length === 0) return <SinDatos def={def} origen={origen} texto="Sin hallazgos registrados en esta orden." />;

  return (
    <>
      {dias.map(([fecha, filas]) => (
        <section className="hoja hoja-v" key={fecha}>
          <div className="marco">
            <Membrete titulo="Formato de defectos y hallazgos en proceso" />

            <table className="campos" style={{ tableLayout: 'fixed' }}>
              <tbody>
                <tr>
                  <td className="et" style={{ width: '16%', textAlign: 'center' }}>Orden</td>
                  <td className="val" style={{ width: '17%' }}>{orden.numero_orden}</td>
                  <td className="et" style={{ width: '17%', textAlign: 'center' }}>Supervisor</td>
                  <td className="val" style={{ width: '22%' }} />
                  <td className="et" style={{ width: '11%', textAlign: 'center' }}>Fecha</td>
                  <td className="val" style={{ width: '17%' }}>{fechaCorta(fecha)}</td>
                </tr>
                <tr>
                  <td className="et" style={{ textAlign: 'center' }}>Cantidad</td>
                  <td className="val">{orden.cantidad.toLocaleString()}</td>
                  <td className="et" style={{ textAlign: 'center' }}>Cliente</td>
                  <td className="val">{orden.cliente}</td>
                  <td className="et" style={{ textAlign: 'center' }}>Turno</td>
                  <td className="val">{filas[0]?.turno ?? ''}</td>
                </tr>
              </tbody>
            </table>

            <table className="datos">
              <colgroup>
                <col style={{ width: '11%' }} /><col style={{ width: '14%' }} />
                <col style={{ width: '14%' }} /><col style={{ width: '21%' }} />
                <col style={{ width: '16%' }} /><col style={{ width: '24%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th># MESA</th><th># ETIQUETA</th><th># MAQUINA</th>
                  <th>OPERADOR</th><th>TIPO DE DEFECTO</th><th>APROBADO/RECHAZADO</th>
                </tr>
              </thead>
              <tbody>
                {filas.map(r => (
                  <tr key={r.id}>
                    <td>{r.mesa}</td><td>{r.etiqueta}</td><td>{r.maquina}</td>
                    <td className="izq">{r.operador}</td><td>{r.defecto}</td>
                    <td className="izq">{r.resultado}</td>
                  </tr>
                ))}
                {vacias(34 - filas.length, 6)}
              </tbody>
            </table>

            {/* Catálogo del pie, en las mismas tres columnas del preimpreso */}
            <table className="datos" style={{ marginTop: 'auto' }}>
              <tbody>
                <tr><td colSpan={6} style={{ fontWeight: 700, fontSize: '6.5pt' }}>TIPO DE DEFECTO</td></tr>
                {Array.from({ length: 5 }, (_, i) => (
                  <tr key={i}>
                    <td className="izq" style={{ width: '22%', fontSize: '6pt' }}>{DEFECTOS_COL1[i]?.[0] ?? ''}</td>
                    <td style={{ width: '6%', fontSize: '6pt' }}>{DEFECTOS_COL1[i]?.[1] ?? ''}</td>
                    <td className="izq" style={{ width: '34%', fontSize: '6pt' }}>{DEFECTOS_COL2[i]?.[0] ?? ''}</td>
                    <td style={{ width: '6%', fontSize: '6pt' }}>{DEFECTOS_COL2[i]?.[1] ?? ''}</td>
                    <td className="izq" style={{ width: '26%', fontSize: '6pt' }}>{DEFECTOS_COL3[i]?.[0] ?? ''}</td>
                    <td style={{ width: '6%', fontSize: '6pt' }}>{DEFECTOS_COL3[i]?.[1] ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <PieFormato codigo={def.codigo} origen={origen} />
        </section>
      ))}
    </>
  );
}

// ─── EMPAQUE · Control de tarimas y sacos en prensa (PRO-FOR-007) ─────────────

interface TarimaP {
  id: number; numero: number; fecha: string; turno: string; contados: number; peso: number;
}

function HojaEmpaque({ def, orden, datos, origen }: Props) {
  const tarimas = (datos.tarimas ?? []) as TarimaP[];
  if (tarimas.length === 0) return <SinDatos def={def} origen={origen} texto="Sin tarimas capturadas en esta orden." />;

  // La hoja física agrupa cinco tarimas.
  const grupos: (TarimaP | null)[][] = [];
  const lista = [...tarimas].sort((a, b) => a.numero - b.numero);
  for (let i = 0; i < lista.length; i += 5) {
    const g: (TarimaP | null)[] = lista.slice(i, i + 5);
    while (g.length < 5) g.push(null);
    grupos.push(g);
  }

  return (
    <>
      {grupos.map((g, i) => (
        <section className="hoja" key={i}>
          <div className="marco">
            <Membrete titulo="Control de tarimas y sacos en prensa" codigo={def.codigo} />

            <table className="datos">
              <colgroup>
                {Array.from({ length: 5 }, (_, k) => <col key={k} style={{ width: '20%' }} />)}
              </colgroup>
              <tbody>
                <tr>
                  <td className="izq">Turno: {g[0]?.turno ?? ''}</td>
                  <td className="izq">Supervisor:</td>
                  <td className="izq">Orden: {orden.numero_orden}</td>
                  <td className="izq">Cliente: {orden.cliente}</td>
                  <td className="izq" />
                </tr>
                <tr>
                  {g.map((t, k) => (
                    <td key={k} className="izq">
                      Fecha: {t ? fechaCorta(t.fecha) : ''} &nbsp;&nbsp; N° Tarima: {t?.numero ?? ''}
                    </td>
                  ))}
                </tr>
                <tr>
                  {g.map((t, k) => (
                    <td key={k} style={{ padding: 0, verticalAlign: 'top' }}>
                      <ReticulaPapel total={t?.contados ?? 0} max={200} filas={30} columnas={7} />
                    </td>
                  ))}
                </tr>
                <tr>
                  {g.map((t, k) => (
                    <td key={k} className="izq">Peso: {t?.peso ? `${t.peso} lbs` : ''}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <PieFormato codigo={def.codigo} origen={origen} />
        </section>
      ))}
    </>
  );
}
