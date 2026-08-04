'use client';

// ─────────────────────────────────────────────────────────────────────────────
//  DISEÑO DE UN SACO (spec) — alta y edición.
//
//  Mismo flujo que crear una orden, pero con lo que NO cambia entre órdenes:
//  el PDF del diseño, las especificaciones del saco y su explosión de
//  materiales. Al crear una orden con este spec, todo esto se carga solo y la
//  captura se reduce a número de orden, cantidad, FMF y línea.
//
//    /clientes/diseno?cliente=BULK%20LIFT   → alta
//    /clientes/diseno?spec=MEXQ07354        → edición
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useSession, canUpload } from '@/autenticacion/auth';
import { combinarMedida, separarMedida, TIPOS_SACO, GRADOS } from '@/ordenes/medida';
import { elementosDesdePlantilla, type ElementoCorte } from '@/explosion-materiales/explosion';
import {
  TablaCorteEditable, TextoLeido, aplicarCambio, nuevaFila, mensajeLectura,
} from '@/explosion-materiales/ui/ExplosionMateriales';

const MAX_MB = 10;
const MAX_PDF_BYTES = MAX_MB * 1024 * 1024;

const inputCls =
  'w-full px-3 py-2 text-sm border border-[#E2E5E2] rounded-lg bg-[#F8FAF8] focus:outline-none focus:ring-1 focus:ring-brand-green focus:border-brand-green transition-colors';

export default function DisenoFormPage() {
  const router = useRouter();
  const { sesion, ready } = useSession();
  const permitido = canUpload(sesion?.rol);

  useEffect(() => {
    if (ready && !permitido) router.replace('/dashboard');
  }, [ready, permitido, router]);

  // ── Parámetros: alta (?cliente=) o edición (?spec=) ────────────────────────
  const [specEditando, setSpecEditando] = useState('');
  // El diseño se crea PARA un cliente concreto: si viene en la URL, el campo
  // queda fijo (no tiene sentido cambiárselo a medio registro).
  const [clienteFijo, setClienteFijo] = useState(false);
  const [paramListo, setParamListo] = useState(false);
  const [form, setForm] = useState({
    cliente: '',
    spec: '',
    medida: '',
    medida_unidad: 'pulg',
    carga_lbs: '',
    tipo_saco: 'U-PANEL',
    grado: '',
  });

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const sp = (p.get('spec') ?? '').trim().toUpperCase();
    const cli = p.get('cliente') ?? '';
    if (sp) setSpecEditando(sp);
    if (cli) setClienteFijo(true);
    setForm(f => ({ ...f, cliente: cli || f.cliente, spec: sp || f.spec }));
    setParamListo(true);
  }, []);

  const editando = !!specEditando;

  const [guardando, setGuardando] = useState(false);
  const [cargandoDiseno, setCargandoDiseno] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);

  const [pdfName, setPdfName] = useState('');
  const [pdfDataUrl, setPdfDataUrl] = useState('');   // vacío al editar = conserva el guardado
  const [pdfGuardado, setPdfGuardado] = useState(false);
  const [arrastrando, setArrastrando] = useState(false);

  const [corteElementos, setCorteElementos] = useState<ElementoCorte[]>([]);
  const [corteTexto, setCorteTexto] = useState('');
  const [leyendoCorte, setLeyendoCorte] = useState(false);
  const [corteMsg, setCorteMsg] = useState<{ tipo: 'ok' | 'error' | 'info'; texto: string } | null>(null);

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  // Clientes del registro, para el selector del alta.
  const [clientes, setClientes] = useState<string[]>([]);
  useEffect(() => {
    if (!sesion?.email) return;
    let cancelado = false;
    fetch('/api/clientes', { headers: { 'x-user-email': sesion.email } })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!cancelado && d?.clientes) {
          setClientes((d.clientes as { nombre: string }[]).map(c => c.nombre));
        }
      })
      .catch(() => {});
    return () => { cancelado = true; };
  }, [sesion?.email]);

  // Semilla de la explosión con la plantilla del tipo de saco (solo en alta).
  const seed = useRef(false);
  useEffect(() => {
    if (seed.current || editando || !paramListo) return;
    seed.current = true;
    setCorteElementos(elementosDesdePlantilla(form.tipo_saco));
  }, [editando, paramListo, form.tipo_saco]);

  // Edición: cargar el diseño guardado.
  useEffect(() => {
    if (!editando || !sesion?.email) return;
    let cancelado = false;
    setCargandoDiseno(true);
    fetch(`/api/specs/${encodeURIComponent(specEditando)}`, { headers: { 'x-user-email': sesion.email } })
      .then(async r => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d?.error ?? 'No se pudo cargar el diseño.');
        return d;
      })
      .then(d => {
        if (cancelado) return;
        const dis = (d.diseno ?? d.orden) as {
          tipo_saco: string; medida: string; carga_lbs: number;
          grado: string | null; corte_elementos: ElementoCorte[] | null; pdf_url: string | null;
        } | null;
        const m = separarMedida(dis?.medida ?? '');
        setForm(f => ({
          ...f,
          cliente: (d.cliente as string) ?? f.cliente,
          spec: (d.spec as string) ?? f.spec,
          medida: m.dims,
          medida_unidad: m.unidad ?? 'pulg',
          carga_lbs: dis?.carga_lbs ? String(dis.carga_lbs) : '',
          tipo_saco: dis?.tipo_saco || 'U-PANEL',
          grado: dis?.grado ?? '',
        }));
        if (dis?.corte_elementos?.length) setCorteElementos(dis.corte_elementos);
        else setCorteElementos(elementosDesdePlantilla(dis?.tipo_saco || 'U-PANEL'));
        if (dis?.pdf_url) {
          setPdfGuardado(true);
          setPdfName(`${specEditando}.pdf`);
        }
      })
      .catch(e => { if (!cancelado) setError(e.message); })
      .finally(() => { if (!cancelado) setCargandoDiseno(false); });
    return () => { cancelado = true; };
  }, [editando, specEditando, sesion?.email]);

  // ── PDF ────────────────────────────────────────────────────────────────────
  function procesarArchivo(file: File | undefined | null) {
    setError(null);
    if (!file) return;
    if (file.type !== 'application/pdf') { setError('El archivo debe ser un PDF.'); return; }
    if (file.size > MAX_PDF_BYTES) {
      setError(`El PDF pesa ${(file.size / 1024 / 1024).toFixed(1)} MB. El máximo es ${MAX_MB} MB.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setPdfDataUrl(reader.result as string);
      setPdfName(file.name);
      setPdfGuardado(false);
    };
    reader.onerror = () => setError('No se pudo leer el archivo.');
    reader.readAsDataURL(file);
  }

  async function leerCorteDelPdf() {
    if (!pdfDataUrl) return;
    setLeyendoCorte(true);
    setCorteMsg(null);
    try {
      const res = await fetch('/api/explosion/extraer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-email': sesion?.email ?? '' },
        body: JSON.stringify({ pdf_base64: pdfDataUrl, tipo_saco: form.tipo_saco }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setCorteMsg({ tipo: 'error', texto: data?.error ?? 'No se pudo leer el PDF.' }); return; }
      setCorteElementos(data.elementos as ElementoCorte[]);
      setCorteTexto(typeof data.textoCrudo === 'string' ? data.textoCrudo : '');
      mensajeLectura(data.metodo, setCorteMsg);
    } catch {
      setCorteMsg({ tipo: 'error', texto: 'No se pudo conectar con el servidor.' });
    } finally {
      setLeyendoCorte(false);
    }
  }

  // ── Guardar ────────────────────────────────────────────────────────────────
  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!editando && !pdfDataUrl) {
      setError('Sube el PDF del diseño.');
      return;
    }
    setGuardando(true);
    setError(null);

    const cuerpo = {
      cliente: form.cliente,
      spec: form.spec,
      medida: combinarMedida(form.medida, form.medida_unidad),
      carga_lbs: form.carga_lbs,
      tipo_saco: form.tipo_saco,
      grado: form.grado,
      corte_elementos: corteElementos,
      pdf_base64: pdfDataUrl,        // vacío al editar = conserva el guardado
      pdf_nombre: pdfName,
    };

    try {
      const res = editando
        ? await fetch(`/api/specs/${encodeURIComponent(specEditando)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'x-user-email': sesion?.email ?? '' },
            body: JSON.stringify(cuerpo),
          })
        : await fetch('/api/specs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-user-email': sesion?.email ?? '' },
            body: JSON.stringify(cuerpo),
          });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data?.error ?? 'No se pudo guardar el diseño.'); return; }
      setListo(true);
      setTimeout(() => router.push('/clientes'), 900);
    } catch {
      setError('No se pudo conectar con el servidor.');
    } finally {
      setGuardando(false);
    }
  }

  if (!ready || !paramListo) return <Cargando texto="Cargando…" />;
  if (!permitido) return null;
  if (editando && cargandoDiseno) return <Cargando texto="Cargando el diseño…" />;

  if (listo) {
    return (
      <div className="p-6 max-w-2xl mx-auto flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-brand-green-light flex items-center justify-center mx-auto mb-4">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <circle cx="16" cy="16" r="14" stroke="#009166" strokeWidth="2" />
              <path d="M10 16l4 4 8-8" stroke="#009166" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-[#1A1A1A] mb-1">
            {editando ? '¡Diseño actualizado!' : '¡Diseño registrado!'}
          </h2>
          <p className="text-sm text-[#6B716C]">Regresando al registro de clientes…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 max-w-3xl mx-auto pb-12">
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/clientes" className="text-sm text-[#6B716C] hover:text-[#1A1A1A] flex items-center gap-1">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            Clientes
          </Link>
          <span className="text-[#E2E5E2]">/</span>
          <span className="text-sm text-[#1A1A1A] font-medium">
            {editando ? `Diseño ${specEditando}` : 'Nuevo diseño'}
          </span>
        </div>
        <h1 className="text-xl font-semibold text-[#1A1A1A]">
          {editando ? 'Editar diseño del saco' : 'Nuevo diseño de saco'}
        </h1>
        <p className="text-sm text-[#6B716C] mt-1">
          Es lo que no cambia entre órdenes: el PDF del diseño, las especificaciones y la explosión
          de materiales. Al crear una orden con este spec, todo se carga solo.
        </p>
      </div>

      <form onSubmit={guardar} className="space-y-5">
        {/* ── PDF del diseño ── */}
        <FormSection title="PDF del diseño">
          <label
            htmlFor="pdf"
            onDragEnter={(e) => { e.preventDefault(); setArrastrando(true); }}
            onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }}
            onDragLeave={(e) => { e.preventDefault(); setArrastrando(false); }}
            onDrop={(e) => { e.preventDefault(); setArrastrando(false); procesarArchivo(e.dataTransfer.files?.[0]); }}
            className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-xl px-4 py-8 cursor-pointer transition-colors ${
              arrastrando
                ? 'border-brand-green bg-brand-green-50/60'
                : pdfName
                ? 'border-brand-green/50 bg-brand-green-50/40'
                : 'border-[#D6DED7] hover:border-brand-green/40 bg-[#F8FAF8]'
            }`}
          >
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <path d="M16 21V7m0 0l-5 5m5-5l5 5" stroke="#009166" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M6 21v3a1 1 0 001 1h18a1 1 0 001-1v-3" stroke="#009166" strokeWidth="2" strokeLinecap="round" />
            </svg>
            {pdfName ? (
              <span className="text-sm font-medium text-[#1A1A1A]">📄 {pdfName}</span>
            ) : (
              <>
                <span className="text-sm font-medium text-[#1A1A1A]">
                  {arrastrando ? 'Suelta el PDF aquí' : 'Arrastra el PDF del diseño o haz clic para subir'}
                </span>
                <span className="text-xs text-[#8A9A8C]">Solo PDF · máximo {MAX_MB} MB</span>
              </>
            )}
            <input id="pdf" type="file" accept="application/pdf" className="hidden"
              onChange={(e) => procesarArchivo(e.target.files?.[0])} />
          </label>
          {pdfGuardado && !pdfDataUrl && (
            <p className="text-xs text-[#6B716C] mt-2">
              Este diseño ya tiene un PDF guardado. Arrastra otro solo si hay una revisión nueva.
            </p>
          )}
        </FormSection>

        {/* ── Identificación ── */}
        <FormSection title="Identificación">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Cliente *" required>
              <input
                required list="clientes-diseno" autoComplete="off"
                disabled={editando || clienteFijo}
                value={form.cliente} onChange={(e) => set('cliente', e.target.value)}
                placeholder="BULK LIFT"
                className={`${inputCls} disabled:bg-[#F0F5F0] disabled:text-[#1A1A1A] disabled:font-semibold`}
              />
              <datalist id="clientes-diseno">
                {clientes.map(c => <option key={c} value={c} />)}
              </datalist>
              {(editando || clienteFijo) && (
                <p className="text-[10px] text-[#8A9A8C] mt-1">
                  El diseño pertenece a este cliente. Para otro, entra desde su tarjeta en Clientes.
                </p>
              )}
            </Field>
            <Field label="Spec *" required>
              <input
                required disabled={editando}
                value={form.spec} onChange={(e) => set('spec', e.target.value.toUpperCase())}
                placeholder="MEXQ07354" className={`${inputCls} font-mono disabled:opacity-70`}
              />
              <p className="text-[10px] text-[#8A9A8C] mt-1">
                {editando ? 'El spec no se puede cambiar.' : 'Único e irrepetible en todo el sistema.'}
              </p>
            </Field>
          </div>
        </FormSection>

        {/* ── Especificaciones del saco ── */}
        <FormSection title="Especificaciones del saco">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Field label="Medida *" required>
              <input required value={form.medida} onChange={(e) => set('medida', e.target.value)}
                placeholder={form.medida_unidad === 'cm' ? '90 x 90 x 127' : '36 x 36 x 50'} className={inputCls} />
            </Field>
            <Field label="Unidad de medida">
              <select value={form.medida_unidad} onChange={(e) => set('medida_unidad', e.target.value)} className={inputCls}>
                <option value="pulg">Pulgadas</option>
                <option value="cm">Centímetros</option>
              </select>
            </Field>
            <Field label="Carga (Lbs) *" required>
              <input required type="number" min="1" value={form.carga_lbs}
                onChange={(e) => set('carga_lbs', e.target.value)} placeholder="2205" className={inputCls} />
            </Field>
            <Field label="Tipo de saco *" required>
              <select value={form.tipo_saco} onChange={(e) => set('tipo_saco', e.target.value)} className={inputCls}>
                {TIPOS_SACO.map(t => <option key={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Grado">
              <select value={form.grado} onChange={(e) => set('grado', e.target.value)} className={inputCls}>
                {GRADOS.map(g => <option key={g} value={g}>{g || '— Sin grado especial —'}</option>)}
              </select>
            </Field>
          </div>
        </FormSection>

        {/* ── Elementos de corte ── */}
        <FormSection title="Elementos de corte y sus medidas">
          <div className="space-y-3">
            <p className="text-xs text-[#6B716C]">
              Qué se corta para este saco y con qué medidas. Aquí no se calculan totales: la cantidad
              de sacos la pone cada orden, y ahí se hacen las cuentas.
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button" onClick={leerCorteDelPdf} disabled={leyendoCorte || !pdfDataUrl}
                title={!pdfDataUrl ? 'Sube el PDF arriba para poder leerlo' : undefined}
                className="flex items-center gap-1.5 text-xs font-medium text-[#1A1A1A] border border-brand-green/30 hover:bg-brand-green-50 rounded-md px-3 py-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {leyendoCorte ? 'Leyendo PDF…' : 'Leer del PDF'}
              </button>
              <button
                type="button" onClick={() => setCorteElementos(elementosDesdePlantilla(form.tipo_saco))}
                className="text-xs font-medium text-[#1A1A1A] border border-[#E2E5E2] hover:bg-[#F6F8F1] rounded-md px-3 py-1.5 transition-colors"
              >
                Reiniciar desde plantilla ({form.tipo_saco})
              </button>
            </div>

            {corteMsg && (
              <div className={`text-sm text-[#1A1A1A] rounded-lg border px-3 py-2 ${
                corteMsg.tipo === 'error'
                  ? 'bg-red-50 border-red-200'
                  : corteMsg.tipo === 'info'
                  ? 'bg-brand-orange-light/40 border-brand-orange/30'
                  : 'bg-brand-green-50 border-brand-green/30'
              }`}>
                {corteMsg.texto}
              </div>
            )}

            <TablaCorteEditable
              elementos={corteElementos}
              tipoSaco={form.tipo_saco}
              onActualizar={(idx, campo, valor) => setCorteElementos(p => aplicarCambio(p, idx, campo, valor))}
              onAgregar={(el) => setCorteElementos(p => [...p, nuevaFila(el)])}
              onQuitar={(idx) => setCorteElementos(p => p.filter((_, i) => i !== idx))}
            />
            <TextoLeido texto={corteTexto} />
          </div>
        </FormSection>

        {error && (
          <div className="bg-red-50 border border-red-200 text-[#1A1A1A] text-sm rounded-lg px-3.5 py-2.5">
            {error}
          </div>
        )}

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit" disabled={guardando}
            className="flex items-center gap-2 bg-brand-green text-white text-sm font-semibold px-6 py-2.5 rounded-lg hover:bg-brand-green-dark active:scale-[0.98] transition-all disabled:opacity-60 shadow-sm"
          >
            {guardando ? 'Guardando…' : editando ? 'Guardar cambios' : 'Registrar diseño'}
          </button>
          <Link href="/clientes" className="text-sm text-[#6B716C] hover:text-[#1A1A1A] transition-colors px-4 py-2.5">
            Cancelar
          </Link>
        </div>
      </form>
    </div>
  );
}

function Cargando({ texto }: { texto: string }) {
  return (
    <div className="p-6 flex items-center justify-center min-h-[40vh] text-sm text-[#6B716C]">
      <svg className="animate-spin h-4 w-4 mr-2" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      {texto}
    </div>
  );
}

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-[#E2E5E2] rounded-xl shadow-card overflow-hidden">
      <div className="px-4 py-2.5 border-b border-[#E8EFE9] bg-brand-green-50/40">
        <h2 className="text-sm font-semibold text-[#1A1A1A]">{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-[#1A1A1A] mb-1.5">
        {label}{required && <span className="text-[#1A1A1A] ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}
