'use client';

import { useMemo, useRef, useState } from 'react';
import { useSession, canUpload } from '@/autenticacion/auth';
import { useProduccion } from '@/produccion/produccion-store';
import NumeroInput from '@/compartido/ui/NumeroInput';
import {
  calcularExplosion,
  elementosDesdePlantilla,
  opcionesCorte,
  fmt,
  GRUPO_LABEL,
  type ElementoCorte,
  type UnidadMedida,
  type GrupoCorte,
  type GrupoResultado,
  type ResultadoExplosion,
} from '@/explosion-materiales/explosion';
import type { Orden } from '@/compartido/mock-data';

const inCls =
  'w-full px-2 py-1 text-sm border border-[#E2E5E2] rounded-md bg-[#F8FAF8] focus:outline-none focus:ring-1 focus:ring-brand-green focus:border-brand-green';

const GRUPOS: GrupoCorte[] = ['tela', 'cinturones', 'cintas'];

// ─── Helpers puros (compartidos por el detalle y por "Nueva orden") ─────────────
export function aplicarCambio(
  elementos: ElementoCorte[],
  idx: number,
  campo: keyof ElementoCorte,
  valor: string,
): ElementoCorte[] {
  return elementos.map((el, i) => {
    if (i !== idx) return el;
    if (campo === 'nombre') return { ...el, nombre: valor };
    if (campo === 'unidad') return { ...el, unidad: (valor === 'cm' ? 'cm' : 'in') as UnidadMedida };
    if (campo === 'grupo') return { ...el, grupo: valor as GrupoCorte };
    const n = parseFloat(valor);
    return { ...el, [campo]: Number.isFinite(n) ? n : 0 };
  });
}

export function nuevaFila(el?: ElementoCorte): ElementoCorte {
  return el ? { ...el } : { nombre: '', piezasPorSaco: 1, ancho: 0, largo: 0, unidad: 'in', grupo: 'tela' };
}

// ─── Tabla editable (reutilizable) ──────────────────────────────────────────────
export function TablaCorteEditable({
  elementos,
  tipoSaco,
  bloqueada = false,
  onActualizar,
  onAgregar,
  onQuitar,
}: {
  elementos: ElementoCorte[];
  // Tipo de saco de la orden: sus elementos de plantilla también se ofrecen en
  // "Agregar" (por si se elimina uno por error, se recupera con un clic).
  tipoSaco?: string;
  // Con la tabla bloqueada los campos son de solo lectura: así nadie mueve las
  // cuentas de una orden ya guardada al pasar por encima con el cursor.
  bloqueada?: boolean;
  onActualizar: (idx: number, campo: keyof ElementoCorte, valor: string) => void;
  onAgregar: (el?: ElementoCorte) => void;
  onQuitar: (idx: number) => void;
}) {
  // Solo se ofrecen los elementos que AÚN NO están en la tabla.
  const opciones = useMemo(() => {
    const enTabla = new Set(elementos.map((el) => el.nombre.trim().toLowerCase()));
    return opcionesCorte(tipoSaco).filter((op) => !enTabla.has(op.nombre.toLowerCase()));
  }, [tipoSaco, elementos]);

  return (
    <div className="space-y-3">
      {/* Agregar opcionales con un clic */}
      {!bloqueada && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-[#8A9A8C] mr-1">Agregar:</span>
          {opciones.map((op) => (
            <button
              key={op.nombre}
              type="button"
              onClick={() => onAgregar(op)}
              className="text-[11px] text-[#1A1A1A] border border-dashed border-[#D6DED7] hover:border-brand-green/50 hover:bg-brand-green-50/40 rounded-md px-2 py-1 transition-colors"
            >
              + {op.nombre}
            </button>
          ))}
          <button
            type="button"
            onClick={() => onAgregar()}
            className="text-[11px] text-[#1A1A1A] border border-[#E2E5E2] hover:bg-[#F6F8F1] rounded-md px-2 py-1 transition-colors"
          >
            + Fila vacía
          </button>
        </div>
      )}

      <div className="overflow-x-auto -mx-1 px-1">
        <table className="w-full min-w-[560px] text-sm border-collapse">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-[#8A9A8C]">
              <th className="py-1.5 pr-2 font-medium">Elemento</th>
              <th className="py-1.5 px-2 font-medium w-28">Grupo</th>
              <th className="py-1.5 px-2 font-medium w-24">Pzas/saco</th>
              <th className="py-1.5 px-2 font-medium w-24">Ancho</th>
              <th className="py-1.5 px-2 font-medium w-24">Largo</th>
              <th className="py-1.5 px-2 font-medium w-20">Unidad</th>
              <th className="py-1.5 pl-2 w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F0F5F0]">
            {elementos.map((el, idx) => (
              <tr key={idx}>
                <td className="py-1.5 pr-2">
                  <input disabled={bloqueada} className={inCls} value={el.nombre} onChange={e => onActualizar(idx, 'nombre', e.target.value)} placeholder="Ej. Laterales" />
                </td>
                <td className="py-1.5 px-2">
                  <select disabled={bloqueada} className={inCls} value={el.grupo} onChange={e => onActualizar(idx, 'grupo', e.target.value)}>
                    {GRUPOS.map(g => <option key={g} value={g}>{GRUPO_LABEL[g]}</option>)}
                  </select>
                </td>
                <td className="py-1.5 px-2">
                  <NumeroInput disabled={bloqueada} className={`${inCls} font-mono`} valor={el.piezasPorSaco} onValor={v => onActualizar(idx, 'piezasPorSaco', v)} />
                </td>
                <td className="py-1.5 px-2">
                  <NumeroInput disabled={bloqueada} step="0.01" className={`${inCls} font-mono`} valor={el.ancho} onValor={v => onActualizar(idx, 'ancho', v)} />
                </td>
                <td className="py-1.5 px-2">
                  <NumeroInput disabled={bloqueada} step="0.01" className={`${inCls} font-mono`} valor={el.largo} onValor={v => onActualizar(idx, 'largo', v)} />
                </td>
                <td className="py-1.5 px-2">
                  <select disabled={bloqueada} className={inCls} value={el.unidad} onChange={e => onActualizar(idx, 'unidad', e.target.value)}>
                    <option value="in">pulg</option>
                    <option value="cm">cm</option>
                  </select>
                </td>
                <td className="py-1.5 pl-2 text-center">
                  {!bloqueada && (
                    <button type="button" onClick={() => onQuitar(idx)} title="Quitar" className="text-[#8A9A8C] hover:text-red-600 transition-colors">✕</button>
                  )}
                </td>
              </tr>
            ))}
            {elementos.length === 0 && (
              <tr>
                <td colSpan={7} className="py-3 text-center text-xs text-[#8A9A8C]">
                  No hay elementos. Usa &quot;Leer del PDF&quot;, &quot;Agregar&quot; o &quot;Fila vacía&quot;.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Resultados por grupo (reutilizable) ────────────────────────────────────────
export function ResultadosExplosion({ resultado }: { resultado: ResultadoExplosion }) {
  return (
    <div className="space-y-4">
      {resultado.grupos.map((g) => (
        <GrupoTabla key={g.grupo} g={g} />
      ))}
    </div>
  );
}

// ─── Visor del texto leído del PDF (ayuda a entender qué se extrajo) ─────────────
export function TextoLeido({ texto }: { texto: string }) {
  const [open, setOpen] = useState(false);
  if (!texto) return null;
  return (
    <div className="text-xs">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="text-[#6B716C] hover:text-[#1A1A1A] underline decoration-dotted"
      >
        {open ? 'Ocultar' : 'Ver'} texto leído del PDF
      </button>
      {open && (
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-[#E8EFE9] bg-[#F8FAF8] p-2 text-[11px] text-[#6B716C]">
          {texto}
        </pre>
      )}
    </div>
  );
}

// ─── Texto introductorio (reutilizable) ─────────────────────────────────────────
export function ExplosionIntro({ cantidad }: { cantidad: number }) {
  return (
    <p className="text-xs text-[#6B716C]">
      Materia prima para el área de corte de esta orden de{' '}
      <span className="font-mono font-medium text-[#1A1A1A]">{cantidad.toLocaleString()}</span> sacos.
      La <span className="font-medium text-[#1A1A1A]">tela</span> se suma en su total; los{' '}
      <span className="font-medium text-[#1A1A1A]">cinturones</span> y{' '}
      <span className="font-medium text-[#1A1A1A]">cintas</span> (que no son tela) llevan su cuenta aparte.
      La longitud lineal asume que el rollo cubre el ancho (se consume el largo).
    </p>
  );
}

// ─── Sección de explosión en el DETALLE de la orden ─────────────────────────────
export default function ExplosionMateriales({ orden }: { orden: Orden }) {
  const { sesion } = useSession();
  // Ver la tabla: admin y diseño (como siempre).
  const editor = canUpload(sesion?.rol);
  // MODIFICARLA en una orden ya creada: solo el admin. Cambiarla mueve las
  // cuentas y los puntos de reporte de todas las áreas, así que no es algo que
  // deba poder tocarse de paso. El servidor valida lo mismo.
  const puedeEditar = sesion?.rol === 'admin';
  const { setCorteElementos, setAvancesOrden } = useProduccion();

  const [elementos, setElementos] = useState<ElementoCorte[]>(
    () => orden.corte_elementos ?? (editor ? elementosDesdePlantilla(orden.tipo_saco) : []),
  );
  const [textoLeido, setTextoLeido] = useState('');
  const [leyendo, setLeyendo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'error' | 'info'; texto: string } | null>(null);

  // La explosión entra BLOQUEADA: pasar por la orden no debe mover las cuentas.
  // Solo se libera al pulsar "Editar", y se vuelve a cerrar al guardar.
  const [editando, setEditando] = useState(false);
  // Copia con la que se entró a editar, para poder cancelar sin guardar.
  const respaldo = useRef<ElementoCorte[]>([]);

  function empezarEdicion() {
    if (!puedeEditar) return;
    respaldo.current = elementos;
    setMsg(null);
    setEditando(true);
  }

  function cancelarEdicion() {
    setElementos(respaldo.current);
    setTextoLeido('');
    setMsg(null);
    setEditando(false);
  }

  const resultado = useMemo(
    () => calcularExplosion(elementos, orden.cantidad),
    [elementos, orden.cantidad],
  );

  const actualizar = (idx: number, campo: keyof ElementoCorte, valor: string) =>
    setElementos(prev => aplicarCambio(prev, idx, campo, valor));
  const agregar = (el?: ElementoCorte) => setElementos(prev => [...prev, nuevaFila(el)]);
  const quitar = (idx: number) => setElementos(prev => prev.filter((_, i) => i !== idx));

  async function leerDelPdf() {
    setLeyendo(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/ordenes/${orden.id}/explosion/extraer`, {
        method: 'POST',
        headers: { 'x-user-email': sesion?.email ?? '' },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ tipo: 'error', texto: data?.error ?? 'No se pudo leer el PDF.' });
        return;
      }
      setElementos(data.elementos as ElementoCorte[]);
      setTextoLeido(typeof data.textoCrudo === 'string' ? data.textoCrudo : '');
      mensajeLectura(data.metodo, setMsg);
    } catch {
      setMsg({ tipo: 'error', texto: 'No se pudo conectar con el servidor.' });
    } finally {
      setLeyendo(false);
    }
  }

  async function guardar() {
    setGuardando(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/ordenes/${orden.id}/explosion`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-user-email': sesion?.email ?? '' },
        body: JSON.stringify({ elementos }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ tipo: 'error', texto: data?.error ?? 'No se pudo guardar.' });
        return;
      }
      const guardados = data.elementos as ElementoCorte[];
      setElementos(guardados);
      setCorteElementos(orden.id, guardados);
      // El servidor re-sincroniza la captura de TODAS las áreas con estos
      // elementos; la reflejamos en pantalla sin recargar.
      if (Array.isArray(data.avances)) {
        setAvancesOrden(orden.id, data.avances);
      }
      setMsg({
        tipo: 'ok',
        texto: 'Explosión guardada. Los puntos de reporte de TODAS las áreas quedaron sincronizados con estos elementos.',
      });
      // Guardado correcto: se vuelve a bloquear.
      setEditando(false);
    } catch {
      setMsg({ tipo: 'error', texto: 'No se pudo conectar con el servidor.' });
    } finally {
      setGuardando(false);
    }
  }

  if (!editor && elementos.length === 0) {
    return (
      <p className="text-sm text-[#6B716C]">
        Aún no se ha capturado la explosión de materiales para esta orden.
      </p>
    );
  }

  const msgCls =
    msg?.tipo === 'error'
      ? 'bg-red-50 border-red-200'
      : msg?.tipo === 'info'
      ? 'bg-brand-orange-light/40 border-brand-orange/30'
      : 'bg-brand-green-50 border-brand-green/30';

  return (
    <div className="space-y-4">
      <ExplosionIntro cantidad={orden.cantidad} />

      {editor && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {editando ? (
              <>
                <button
                  type="button"
                  onClick={leerDelPdf}
                  disabled={leyendo || !orden.pdf_url}
                  title={!orden.pdf_url ? 'Esta orden no tiene PDF' : undefined}
                  className="flex items-center gap-1.5 text-xs font-medium text-[#1A1A1A] border border-brand-green/30 hover:bg-brand-green-50 rounded-md px-3 py-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {leyendo ? 'Leyendo PDF…' : 'Leer del PDF'}
                </button>
                <button
                  type="button"
                  onClick={cancelarEdicion}
                  disabled={guardando}
                  className="ml-auto text-xs font-medium text-[#6B716C] hover:text-[#1A1A1A] border border-[#E2E5E2] hover:bg-[#F6F8F1] rounded-md px-3 py-1.5 transition-colors disabled:opacity-60"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={guardar}
                  disabled={guardando}
                  className="flex items-center gap-1.5 bg-brand-green text-white text-xs font-semibold px-4 py-1.5 rounded-md hover:bg-brand-green-dark transition-colors disabled:opacity-60"
                >
                  {guardando ? 'Guardando…' : 'Guardar'}
                </button>
              </>
            ) : (
              <>
                <span className="inline-flex items-center gap-1.5 text-[11px] text-[#6B716C]">
                  <svg width="12" height="12" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                    <rect x="3.5" y="8" width="11" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M6 8V6a3 3 0 016 0v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                  {puedeEditar
                    ? 'Bloqueada para que no se mueva sin querer.'
                    : 'Solo un administrador puede modificar la explosión de una orden.'}
                </span>
                {puedeEditar && (
                  <button
                    type="button"
                    onClick={empezarEdicion}
                    className="ml-auto flex items-center gap-1.5 text-xs font-semibold text-[#1A6B4A] border border-brand-green/40 hover:bg-brand-green-50 rounded-md px-4 py-1.5 transition-colors"
                  >
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <path d="M11 2.5l2.5 2.5L6 12.5 3 13l.5-3L11 2.5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                    </svg>
                    Editar
                  </button>
                )}
              </>
            )}
          </div>

          {msg && (
            <div className={`text-sm text-[#1A1A1A] rounded-lg border px-3 py-2 ${msgCls}`}>{msg.texto}</div>
          )}

          <TablaCorteEditable
            elementos={elementos}
            tipoSaco={orden.tipo_saco}
            bloqueada={!editando}
            onActualizar={actualizar}
            onAgregar={agregar}
            onQuitar={quitar}
          />
          <TextoLeido texto={textoLeido} />
        </>
      )}

      <ResultadosExplosion resultado={resultado} />
    </div>
  );
}

// Mensaje según el método de lectura. Exportado para reusar en "Nueva orden".
export function mensajeLectura(
  metodo: unknown,
  set: (m: { tipo: 'ok' | 'error' | 'info'; texto: string }) => void,
) {
  const detalle =
    metodo === 'ocr'
      ? 'Leído por OCR (imagen).'
      : metodo === 'texto'
      ? 'Leído del texto del PDF.'
      : 'No se pudieron leer medidas del PDF; captúralas a mano.';
  set({
    tipo: metodo === 'ninguno' ? 'info' : 'ok',
    texto: `${detalle} Revisa, agrega los elementos que falten y corrige las medidas.`,
  });
}

function GrupoTabla({ g }: { g: GrupoResultado }) {
  const esTela = g.grupo === 'tela';
  return (
    <div className="overflow-x-auto rounded-lg border border-[#E8EFE9]">
      <div className={`px-3 py-2 text-xs font-semibold border-b border-[#E8EFE9] ${esTela ? 'bg-brand-green-50' : 'bg-[#F6F8F1]'}`}>
        {g.etiqueta}

      </div>
      <table className="w-full min-w-[640px] text-sm border-collapse">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wide text-[#8A9A8C] bg-white">
            <th className="py-2 px-3 font-medium">Elemento</th>
            <th className="py-2 px-3 font-medium text-right">Medidas</th>
            <th className="py-2 px-3 font-medium text-right">Piezas totales</th>
            <th className="py-2 px-3 font-medium text-right">Pulgadas</th>
            <th className="py-2 px-3 font-medium text-right">Centímetros</th>
            <th className="py-2 px-3 font-medium text-right">Metros</th>
            <th className="py-2 px-3 font-medium text-right">Yardas</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#F0F5F0]">
          {g.elementos.map((r, idx) => (
            <tr key={idx}>
              <td className="py-2 px-3 font-medium text-[#1A1A1A]">{r.nombre || '—'}</td>
              <td className="py-2 px-3 text-right font-mono text-[#6B716C]">{fmt(r.anchoIn)} × {fmt(r.largoIn)}</td>
              <td className="py-2 px-3 text-right font-mono text-[#1A1A1A]">{fmt(r.piezasTotales, 0)}</td>
              <td className="py-2 px-3 text-right font-mono text-[#1A1A1A]">{fmt(r.longitudLineal.in)}</td>
              <td className="py-2 px-3 text-right font-mono">{fmt(r.longitudLineal.cm)}</td>
              <td className="py-2 px-3 text-right font-mono">{fmt(r.longitudLineal.m)}</td>
              <td className="py-2 px-3 text-right font-mono">{fmt(r.longitudLineal.yd)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-[#E2E5E2] bg-[#F8FAF8] font-semibold text-[#1A1A1A]">
            <td className="py-2 px-3" colSpan={2}>Total {g.etiqueta}</td>
            <td className="py-2 px-3 text-right font-mono">{fmt(g.totalPiezas, 0)}</td>
            <td className="py-2 px-3 text-right font-mono">{fmt(g.totalLineal.in)}</td>
            <td className="py-2 px-3 text-right font-mono">{fmt(g.totalLineal.cm)}</td>
            <td className="py-2 px-3 text-right font-mono">{fmt(g.totalLineal.m)}</td>
            <td className="py-2 px-3 text-right font-mono">{fmt(g.totalLineal.yd)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
