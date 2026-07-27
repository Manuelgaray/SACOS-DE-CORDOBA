'use client';

// ─────────────────────────────────────────────────────────────────────────────
//  Registro maestro de clientes y sus productos (specs).
//  Cada cliente tiene 1..N sacos; cada saco se identifica por su spec, que es
//  único e irrepetible. Administra: admin y diseño.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession, canUpload } from '@/autenticacion/auth';
import { Modal, ConfirmModal } from '@/compartido/ui/Modal';
import PdfViewer from '@/compartido/ui/PdfViewer';

interface Cliente {
  nombre: string;
  specs: string[];
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
  // Visor de PDF del spec (dentro de la app: el PDF es dato sensible).
  const [pdfVer, setPdfVer] = useState<{ spec: string; url: string } | null>(null);

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

  async function agregarSpec(cliente: string, spec: string): Promise<string | null> {
    const res = await fetch('/api/specs', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ cliente, spec }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return (data?.error as string) ?? 'No se pudo registrar el spec.';
    cargar();
    return null;
  }

  // Abre el PDF de la última orden del spec en un visor DENTRO de la app
  // (sin pestaña nueva ni descarga: el diseño es información sensible).
  async function verPdf(spec: string) {
    setMsg(null);
    try {
      const res = await fetch(`/api/specs/${encodeURIComponent(spec)}`, { headers: headers() });
      const data = await res.json().catch(() => ({}));
      const pdfUrl = data?.orden?.pdf_url as string | undefined;
      if (res.ok && pdfUrl) {
        setPdfVer({ spec, url: pdfUrl });
      } else {
        setMsg({ tipo: 'error', texto: `El spec ${spec} aún no tiene órdenes con PDF.` });
      }
    } catch {
      setMsg({ tipo: 'error', texto: 'No se pudo conectar con el servidor.' });
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
            {totalSpecs} {totalSpecs === 1 ? 'spec' : 'specs'} (cada spec es único e irrepetible)
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
            onAgregarSpec={(spec) => agregarSpec(c.nombre, spec)}
            onEliminarSpec={(spec) => { setSpecAEliminar({ cliente: c.nombre, spec }); setMsg(null); }}
            onVerPdf={verPdf}
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

      {/* Visor del PDF del spec (solo dentro de la app) */}
      <Modal
        open={!!pdfVer}
        onClose={() => setPdfVer(null)}
        title={`Diseño · ${pdfVer?.spec ?? ''}`}
        size="lg"
      >
        {pdfVer && <PdfViewer url={pdfVer.url} />}
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
  cliente, onRenombrar, onEliminar, onAgregarSpec, onEliminarSpec, onVerPdf,
}: {
  cliente: Cliente;
  onRenombrar: () => void;
  onEliminar: () => void;
  onAgregarSpec: (spec: string) => Promise<string | null>;
  onEliminarSpec: (spec: string) => void;
  onVerPdf: (spec: string) => void;
}) {
  const [nuevoSpec, setNuevoSpec] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [agregando, setAgregando] = useState(false);

  async function submitSpec(e: React.FormEvent) {
    e.preventDefault();
    const spec = nuevoSpec.trim();
    if (!spec) return;
    setAgregando(true);
    setError(null);
    const err = await onAgregarSpec(spec);
    setAgregando(false);
    if (err) {
      setError(err);
    } else {
      setNuevoSpec('');
    }
  }

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

      {/* Specs como fichas */}
      <div className="flex flex-wrap items-center gap-1.5">
        {cliente.specs.map((s) => (
          <span key={s} className="inline-flex items-center gap-1 text-xs font-mono bg-[#F6F8F1] border border-[#E2E5E2] rounded-md pl-2 pr-1 py-1">
            <button
              onClick={() => onVerPdf(s)}
              title={`Ver el PDF de la última orden de ${s}`}
              className="inline-flex items-center gap-1 text-[#1A1A1A] hover:text-brand-green hover:underline decoration-dotted transition-colors"
            >
              <svg width="11" height="11" viewBox="0 0 14 14" fill="none" className="flex-shrink-0">
                <path d="M3 1.5h5L11 4.5v8a1 1 0 01-1 1H3a1 1 0 01-1-1v-10a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                <path d="M8 1.5v3h3" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
              </svg>
              {s}
            </button>
            <button
              onClick={() => onEliminarSpec(s)}
              title={`Eliminar ${s}`}
              className="text-[#8A9A8C] hover:text-red-600 transition-colors px-0.5"
            >
              ✕
            </button>
          </span>
        ))}
        {cliente.specs.length === 0 && (
          <span className="text-xs text-[#8A9A8C]">Sin specs aún.</span>
        )}
      </div>

      {/* Agregar spec */}
      <form onSubmit={submitSpec} className="flex items-center gap-2 mt-3">
        <input
          value={nuevoSpec}
          onChange={(e) => setNuevoSpec(e.target.value.toUpperCase())}
          placeholder="Nuevo spec (ej. MEXQ07354)"
          className="flex-1 min-w-0 px-3 py-1.5 text-xs font-mono border border-[#E2E5E2] rounded-md bg-[#F8FAF8] focus:outline-none focus:ring-1 focus:ring-brand-green focus:border-brand-green"
        />
        <button
          type="submit"
          disabled={agregando || !nuevoSpec.trim()}
          className="text-xs font-semibold text-white bg-brand-green hover:bg-brand-green-dark rounded-md px-3 py-1.5 transition-colors disabled:opacity-50"
        >
          {agregando ? '…' : '+ Agregar'}
        </button>
      </form>
      {error && <p className="text-xs text-red-600 mt-1.5">{error}</p>}
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
