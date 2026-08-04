'use client';

// ─────────────────────────────────────────────────────────────────────────────
//  Registro maestro de clientes y sus productos (specs).
//  Cada cliente tiene 1..N sacos; cada saco se identifica por su spec, que es
//  único e irrepetible. Administra: admin y diseño.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession, canUpload } from '@/autenticacion/auth';
import { Modal, ConfirmModal } from '@/compartido/ui/Modal';
import PdfViewer from '@/compartido/ui/PdfViewer';

// Cada spec es el DISEÑO de un saco: especificaciones + explosión + PDF.
interface Diseno {
  spec: string;
  cliente: string;
  tipo_saco: string;
  medida: string;
  carga_lbs: number;
  grado: string;
  tiene_pdf: boolean;
  tiene_explosion: boolean;
}

interface Cliente {
  nombre: string;
  specs: string[];
  disenos: Diseno[];
}

// Detalle completo de un diseño (lo que se ve al abrir el spec).
interface ElementoCorte {
  nombre: string;
  piezasPorSaco: number;
  ancho: number;
  largo: number;
  unidad: string;
  grupo: string;
}

interface DisenoDetalle {
  spec: string;
  cliente: string | null;
  tipo_saco: string;
  medida: string;
  carga_lbs: number;
  grado: string | null;
  corte_elementos: ElementoCorte[] | null;
  pdf_url: string | null;
  registrado_por?: string | null;
  actualizado_en?: string;
}

const inputCls =
  'w-full px-3 py-2 text-sm border border-[#E2E5E2] rounded-lg bg-[#F8FAF8] focus:outline-none focus:ring-1 focus:ring-brand-green focus:border-brand-green transition-colors';

export default function ClientesPage() {
  const router = useRouter();
  const { sesion, ready } = useSession();
  const permitido = canUpload(sesion?.rol);

  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [cargando, setCargando] = useState(true);
  const [filtro, setFiltro] = useState('');
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);

  // Modales
  const [nuevoAbierto, setNuevoAbierto] = useState(false);
  const [renombrando, setRenombrando] = useState<Cliente | null>(null);
  const [aEliminar, setAEliminar] = useState<Cliente | null>(null);
  const [specAEliminar, setSpecAEliminar] = useState<{ cliente: string; spec: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  // Visor del diseño: medidas capturadas + PDF, dentro de la app (el diseño es
  // información sensible: no se descarga ni se abre en otra pestaña).
  const [disenoVer, setDisenoVer] = useState<DisenoDetalle | null>(null);
  const [cargandoDiseno, setCargandoDiseno] = useState(false);

  useEffect(() => {
    if (ready && !permitido) router.replace('/dashboard');
  }, [ready, permitido, router]);

  const headers = useCallback(
    () => ({ 'Content-Type': 'application/json', 'x-user-email': sesion?.email ?? '' }),
    [sesion?.email],
  );

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const res = await fetch('/api/clientes', { headers: headers() });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setClientes(data.clientes as Cliente[]);
    } finally {
      setCargando(false);
    }
  }, [headers]);

  useEffect(() => {
    if (permitido) cargar();
  }, [permitido, cargar]);

  const filtrados = useMemo(() => {
    const f = filtro.trim().toLowerCase();
    if (!f) return clientes;
    return clientes.filter(
      (c) => c.nombre.toLowerCase().includes(f) || c.specs.some((s) => s.toLowerCase().includes(f)),
    );
  }, [clientes, filtro]);

  const totalSpecs = useMemo(() => clientes.reduce((s, c) => s + c.specs.length, 0), [clientes]);

  async function crearCliente(nombre: string): Promise<string | null> {
    const res = await fetch('/api/clientes', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ nombre }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return (data?.error as string) ?? 'No se pudo registrar.';
    setMsg({ tipo: 'ok', texto: `Cliente ${nombre} registrado.` });
    setNuevoAbierto(false);
    cargar();
    return null;
  }

  async function renombrarCliente(nombre: string): Promise<string | null> {
    if (!renombrando) return null;
    const res = await fetch(`/api/clientes/${encodeURIComponent(renombrando.nombre)}`, {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify({ nombre }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return (data?.error as string) ?? 'No se pudo renombrar.';
    setMsg({ tipo: 'ok', texto: 'Cliente renombrado.' });
    setRenombrando(null);
    cargar();
    return null;
  }

  async function eliminarCliente() {
    if (!aEliminar) return;
    setOcupado(true);
    try {
      const res = await fetch(`/api/clientes/${encodeURIComponent(aEliminar.nombre)}`, {
        method: 'DELETE',
        headers: headers(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ tipo: 'error', texto: data?.error ?? 'No se pudo eliminar.' });
        return;
      }
      setMsg({ tipo: 'ok', texto: `Cliente ${aEliminar.nombre} eliminado del registro.` });
      cargar();
    } finally {
      setOcupado(false);
      setAEliminar(null);
    }
  }

  // Abre el diseño completo (medidas capturadas + PDF) DENTRO de la app.
  // Si el spec aún no tiene ficha, se muestra lo de su última orden.
  async function verDiseno(spec: string) {
    setMsg(null);
    setCargandoDiseno(true);
    try {
      const res = await fetch(`/api/specs/${encodeURIComponent(spec)}`, { headers: headers() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ tipo: 'error', texto: data?.error ?? `No se pudo abrir el spec ${spec}.` });
        return;
      }
      const d = (data.diseno ?? data.orden) as DisenoDetalle | null;
      if (!d) {
        setMsg({ tipo: 'error', texto: `El spec ${spec} todavía no tiene diseño capturado.` });
        return;
      }
      setDisenoVer({ ...d, spec: data.spec ?? spec, cliente: data.cliente ?? null });
    } catch {
      setMsg({ tipo: 'error', texto: 'No se pudo conectar con el servidor.' });
    } finally {
      setCargandoDiseno(false);
    }
  }

  async function eliminarSpec() {
    if (!specAEliminar) return;
    setOcupado(true);
    try {
      const res = await fetch(`/api/specs/${encodeURIComponent(specAEliminar.spec)}`, {
        method: 'DELETE',
        headers: headers(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ tipo: 'error', texto: data?.error ?? 'No se pudo eliminar el spec.' });
        return;
      }
      setMsg({ tipo: 'ok', texto: `Spec ${specAEliminar.spec} eliminado del registro.` });
      cargar();
    } finally {
      setOcupado(false);
      setSpecAEliminar(null);
    }
  }

  if (!ready || (permitido && cargando)) return <Cargando />;
  if (!permitido) return null;

  return (
    <div className="p-4 lg:p-6 max-w-4xl mx-auto space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl lg:text-2xl font-semibold text-[#1A1A1A] mb-0.5">Clientes</h1>
          <p className="text-sm text-[#6B716C]">
            Registro maestro: {clientes.length} {clientes.length === 1 ? 'cliente' : 'clientes'} ·{' '}
            {totalSpecs} {totalSpecs === 1 ? 'diseño' : 'diseños'}. Cada diseño guarda su PDF,
            especificaciones y explosión, y adelanta la captura de la orden.
          </p>
        </div>
        <button
          onClick={() => { setNuevoAbierto(true); setMsg(null); }}
          className="bg-brand-green text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-brand-green-dark transition-colors shadow-sm"
        >
          + Nuevo cliente
        </button>
      </div>

      <input
        value={filtro}
        onChange={(e) => setFiltro(e.target.value)}
        placeholder="Buscar cliente o spec…"
        className={inputCls}
      />

      {cargandoDiseno && (
        <div className="text-sm rounded-lg border border-[#E2E5E2] bg-white px-3.5 py-2.5 text-[#6B716C]">
          Abriendo el diseño…
        </div>
      )}

      {msg && (
        <div
          className={`text-sm rounded-lg border px-3.5 py-2.5 ${
            msg.tipo === 'error' ? 'bg-red-50 border-red-200 text-[#1A1A1A]' : 'bg-brand-green-50 border-brand-green/30 text-[#1A1A1A]'
          }`}
        >
          {msg.texto}
        </div>
      )}

      <div className="space-y-3">
        {filtrados.map((c) => (
          <ClienteCard
            key={c.nombre}
            cliente={c}
            onRenombrar={() => { setRenombrando(c); setMsg(null); }}
            onEliminar={() => { setAEliminar(c); setMsg(null); }}
            onEliminarSpec={(spec) => { setSpecAEliminar({ cliente: c.nombre, spec }); setMsg(null); }}
            onVerDiseno={verDiseno}
          />
        ))}
        {filtrados.length === 0 && (
          <div className="bg-white border border-[#E2E5E2] rounded-xl p-8 text-center text-sm text-[#8A9A8C] shadow-card">
            {clientes.length === 0
              ? 'Aún no hay clientes registrados. Se registran solos al crear órdenes, o agrégalos aquí.'
              : 'Sin resultados para la búsqueda.'}
          </div>
        )}
      </div>

      {/* Nuevo cliente */}
      <Modal open={nuevoAbierto} onClose={() => setNuevoAbierto(false)} title="Nuevo cliente" size="sm">
        <NombreForm etiqueta="Nombre del cliente" boton="Registrar" onSubmit={crearCliente} />
      </Modal>

      {/* Renombrar cliente */}
      <Modal open={!!renombrando} onClose={() => setRenombrando(null)} title={`Renombrar · ${renombrando?.nombre ?? ''}`} size="sm">
        <NombreForm
          key={renombrando?.nombre ?? ''}
          etiqueta="Nuevo nombre"
          boton="Guardar"
          inicial={renombrando?.nombre ?? ''}
          onSubmit={renombrarCliente}
        />
      </Modal>

      {/* Eliminar cliente */}
      <ConfirmModal
        open={!!aEliminar}
        onClose={() => setAEliminar(null)}
        onConfirm={eliminarCliente}
        titulo="Eliminar cliente"
        variante="peligro"
        confirmarTexto="Eliminar"
        cargando={ocupado}
      >
        ¿Eliminar a <span className="font-semibold text-[#1A1A1A]">{aEliminar?.nombre}</span> del registro?
        {(aEliminar?.specs.length ?? 0) > 0 && (
          <> Se eliminarán también sus <span className="font-semibold text-[#1A1A1A]">{aEliminar!.specs.length} specs</span>.</>
        )}{' '}
        Las órdenes ya creadas no se modifican.
      </ConfirmModal>

      {/* Visor del diseño: medidas capturadas + PDF (solo dentro de la app) */}
      <Modal
        open={!!disenoVer}
        onClose={() => setDisenoVer(null)}
        title={`Diseño · ${disenoVer?.spec ?? ''}`}
        size="xl"
      >
        {disenoVer && <VistaDiseno diseno={disenoVer} />}
      </Modal>

      {/* Eliminar spec */}
      <ConfirmModal
        open={!!specAEliminar}
        onClose={() => setSpecAEliminar(null)}
        onConfirm={eliminarSpec}
        titulo="Eliminar spec"
        variante="peligro"
        confirmarTexto="Eliminar"
        cargando={ocupado}
      >
        ¿Eliminar el spec <span className="font-mono font-semibold text-[#1A1A1A]">{specAEliminar?.spec}</span> de{' '}
        <span className="font-semibold text-[#1A1A1A]">{specAEliminar?.cliente}</span>? Las órdenes ya creadas no se modifican.
      </ConfirmModal>
    </div>
  );
}

// ─── Tarjeta de cliente con sus specs ───────────────────────────────────────────

function ClienteCard({
  cliente, onRenombrar, onEliminar, onEliminarSpec, onVerDiseno,
}: {
  cliente: Cliente;
  onRenombrar: () => void;
  onEliminar: () => void;
  onEliminarSpec: (spec: string) => void;
  onVerDiseno: (spec: string) => void;
}) {
  // Specs que están en el registro pero todavía sin ficha de diseño.
  const disenos = cliente.disenos ?? [];
  const conFicha = new Set(disenos.map(d => d.spec));
  const sueltos = cliente.specs.filter(s => !conFicha.has(s));

  return (
    <div className="bg-white border border-[#E2E5E2] rounded-xl shadow-card p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-brand-green-light flex items-center justify-center flex-shrink-0">
            <span className="text-sm font-bold text-[#047150]">{cliente.nombre[0]?.toUpperCase()}</span>
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-[#1A1A1A] truncate">{cliente.nombre}</div>
            <div className="text-[11px] text-[#8A9A8C]">
              {cliente.specs.length} {cliente.specs.length === 1 ? 'saco registrado' : 'sacos registrados'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={onRenombrar} className="text-xs font-medium text-[#1A1A1A] border border-[#E2E5E2] hover:bg-[#F6F8F1] rounded-md px-2.5 py-1 transition-colors">
            Renombrar
          </button>
          <button onClick={onEliminar} className="text-xs font-medium text-red-600 border border-red-200 hover:bg-red-50 rounded-md px-2.5 py-1 transition-colors">
            Eliminar
          </button>
        </div>
      </div>

      {/* Diseños registrados */}
      <div className="space-y-2">
        {disenos.map((d) => (
          <div key={d.spec} className="border border-[#E8EFE9] rounded-lg px-3 py-2.5 hover:border-brand-green/30 transition-colors">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => onVerDiseno(d.spec)}
                    title={`Abrir el diseño de ${d.spec}`}
                    className="text-sm font-mono font-bold text-[#1A1A1A] hover:text-brand-green hover:underline decoration-dotted transition-colors"
                  >
                    {d.spec}
                  </button>
                  {d.tipo_saco && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#F0F5F0] text-[#6B716C]">
                      {d.tipo_saco}
                    </span>
                  )}
                  {d.grado && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-brand-orange-light/50 text-[#6B5418]">
                      {d.grado}
                    </span>
                  )}
                  {!d.tiene_pdf && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#FFF7E8] border border-[#E8C88A] text-[#6B5418]">
                      Sin PDF
                    </span>
                  )}
                  {!d.tiene_explosion && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#FFF7E8] border border-[#E8C88A] text-[#6B5418]">
                      Sin explosión
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-[#8A9A8C] mt-0.5">
                  {d.medida || 'sin medida'}
                  {d.carga_lbs > 0 && <> · <span className="font-mono">{d.carga_lbs.toLocaleString()}</span> lbs</>}
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button onClick={() => onVerDiseno(d.spec)}
                  className="text-xs font-medium text-[#1A1A1A] border border-[#E2E5E2] hover:bg-[#F6F8F1] rounded-md px-2.5 py-1 transition-colors">
                  Ver diseño
                </button>
                <Link href={`/clientes/diseno?spec=${encodeURIComponent(d.spec)}`}
                  className="text-xs font-medium text-[#1A6B4A] border border-brand-green/30 hover:bg-brand-green-50 rounded-md px-2.5 py-1 transition-colors">
                  Editar
                </Link>
                <button onClick={() => onEliminarSpec(d.spec)} title={`Eliminar ${d.spec}`}
                  className="text-[#8A9A8C] hover:text-red-600 transition-colors px-1">
                  ✕
                </button>
              </div>
            </div>
          </div>
        ))}

        {/* Specs heredados de órdenes viejas, aún sin ficha de diseño */}
        {sueltos.map((s) => (
          <div key={s} className="flex items-center justify-between gap-3 flex-wrap border border-dashed border-[#E2E5E2] rounded-lg px-3 py-2">
            <span className="text-sm font-mono text-[#6B716C]">{s}</span>
            <Link href={`/clientes/diseno?spec=${encodeURIComponent(s)}`}
              className="text-xs font-medium text-[#1A6B4A] hover:underline">
              Completar diseño →
            </Link>
          </div>
        ))}

        {disenos.length === 0 && sueltos.length === 0 && (
          <p className="text-xs text-[#8A9A8C]">Sin diseños registrados todavía.</p>
        )}
      </div>

      <Link
        href={`/clientes/diseno?cliente=${encodeURIComponent(cliente.nombre)}`}
        className="inline-flex mt-3 text-xs font-semibold text-white bg-brand-green hover:bg-brand-green-dark rounded-md px-3 py-1.5 transition-colors"
      >
        + Nuevo diseño
      </Link>
    </div>
  );
}

// ─── Vista del diseño: medidas capturadas + PDF ─────────────────────────────────

function VistaDiseno({ diseno }: { diseno: DisenoDetalle }) {
  const elementos = diseno.corte_elementos ?? [];

  return (
    <div className="space-y-4">
      {/* Especificaciones */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Dato label="Cliente" valor={diseno.cliente ?? '—'} />
        <Dato label="Tipo de saco" valor={diseno.tipo_saco || '—'} />
        <Dato label="Medida" valor={diseno.medida || '—'} mono />
        <Dato label="Carga" valor={diseno.carga_lbs ? `${diseno.carga_lbs.toLocaleString()} lbs` : '—'} mono />
      </div>
      {diseno.grado && (
        <div className="text-xs">
          <span className="text-[#8A9A8C]">Grado: </span>
          <span className="font-semibold text-[#1A1A1A]">{diseno.grado}</span>
        </div>
      )}

      {/* Elementos de corte con sus medidas */}
      <div>
        <h3 className="text-xs font-semibold text-[#1A1A1A] uppercase tracking-wide mb-2">
          Elementos de corte
        </h3>
        {elementos.length === 0 ? (
          <p className="text-xs text-[#8A9A8C]">
            Este diseño todavía no tiene elementos capturados.
          </p>
        ) : (
          <div className="border border-[#E2E5E2] rounded-lg overflow-hidden">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-[#F8FAF8] text-[10px] uppercase tracking-wide text-[#8A9A8C] border-b border-[#E2E5E2]">
                  <th className="text-left px-3 py-2 font-medium">Elemento</th>
                  <th className="px-3 py-2 font-medium w-24">Pzas / saco</th>
                  <th className="px-3 py-2 font-medium w-36">Medida</th>
                  <th className="px-3 py-2 font-medium w-24">Grupo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0F5F0]">
                {elementos.map((el, i) => (
                  <tr key={i}>
                    <td className="px-3 py-1.5 text-[#1A1A1A]">{el.nombre}</td>
                    <td className="px-3 py-1.5 text-center font-mono">{el.piezasPorSaco}</td>
                    <td className="px-3 py-1.5 text-center font-mono">
                      {el.ancho > 0 || el.largo > 0
                        ? `${el.ancho} × ${el.largo} ${el.unidad}`
                        : '—'}
                    </td>
                    <td className="px-3 py-1.5 text-center text-[#6B716C]">{el.grupo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* PDF del diseño */}
      <div>
        <h3 className="text-xs font-semibold text-[#1A1A1A] uppercase tracking-wide mb-2">
          PDF del diseño
        </h3>
        {diseno.pdf_url ? (
          <PdfViewer url={diseno.pdf_url} />
        ) : (
          <p className="text-xs text-[#6B5418] bg-[#FFF7E8] border border-[#E8C88A] rounded-lg px-3 py-2">
            Este diseño todavía no tiene PDF. Edítalo para subirlo.
          </p>
        )}
      </div>
    </div>
  );
}

function Dato({ label, valor, mono }: { label: string; valor: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-[#8A9A8C] mb-0.5">{label}</div>
      <div className={`text-sm font-semibold text-[#1A1A1A] ${mono ? 'font-mono' : ''}`}>{valor}</div>
    </div>
  );
}

// ─── Form de nombre (crear / renombrar) ─────────────────────────────────────────

function NombreForm({
  etiqueta, boton, inicial = '', onSubmit,
}: {
  etiqueta: string;
  boton: string;
  inicial?: string;
  onSubmit: (nombre: string) => Promise<string | null>;
}) {
  const [nombre, setNombre] = useState(inicial);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    const err = await onSubmit(nombre.trim());
    setGuardando(false);
    if (err) setError(err);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-[#1A1A1A] mb-1.5">{etiqueta}</label>
        <input
          required autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)}
          placeholder="Ej. BULK LIFT" className={inputCls}
        />
      </div>
      {error && <div className="bg-red-50 border border-red-200 text-[#1A1A1A] text-sm rounded-lg px-3.5 py-2.5">{error}</div>}
      <button
        type="submit" disabled={guardando}
        className="bg-brand-green text-white text-sm font-semibold px-5 py-2 rounded-lg hover:bg-brand-green-dark transition-colors disabled:opacity-60"
      >
        {guardando ? 'Guardando…' : boton}
      </button>
    </form>
  );
}

function Cargando() {
  return (
    <div className="p-6 flex items-center justify-center min-h-[40vh] text-sm text-[#6B716C]">
      <svg className="animate-spin h-4 w-4 mr-2" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      Cargando clientes...
    </div>
  );
}
