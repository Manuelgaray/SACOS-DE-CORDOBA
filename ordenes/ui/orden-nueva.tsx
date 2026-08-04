'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { type OrderStatus } from '@/compartido/mock-data';
import { useProduccion } from '@/produccion/produccion-store';
import { useSession, canUpload } from '@/autenticacion/auth';
import { siguienteNumeroOrden } from '@/ordenes/orden-num';
import { combinarMedida, separarMedida, TIPOS_SACO, GRADOS } from '@/ordenes/medida';
import { elementosDesdePlantilla, calcularExplosion, type ElementoCorte } from '@/explosion-materiales/explosion';
import {
  TablaCorteEditable,
  ResultadosExplosion,
  TextoLeido,
  ExplosionIntro,
  aplicarCambio,
  nuevaFila,
  mensajeLectura,
} from '@/explosion-materiales/ui/ExplosionMateriales';
import { ConfirmModal } from '@/compartido/ui/Modal';

// El PDF se guarda en PostgreSQL (columna bytea). Limitamos el tamaño para evitar
// subidas enormes; 10 MB es de sobra para la carátula/diseño de una orden.
const MAX_MB = 10;
const MAX_PDF_BYTES = MAX_MB * 1024 * 1024;

export default function NuevaOrdenPage() {
  const router = useRouter();
  const { addOrden, ordenes, ready: datosListos } = useProduccion();
  const { sesion, ready } = useSession();
  const allowed = canUpload(sesion?.rol);

  // Solo el encargado de diseños (o admin) puede subir órdenes
  useEffect(() => {
    if (ready && !allowed) router.replace('/ordenes');
  }, [ready, allowed, router]);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmarCrear, setConfirmarCrear] = useState(false);

  const [form, setForm] = useState({
    numero_orden: '',
    cliente: '',
    spec: '',
    medida: '',
    medida_unidad: 'pulg',
    cantidad: '',
    carga_lbs: '',
    tipo_saco: 'U-PANEL',
    orden_cliente: '',
    embarcar_a: '',
    grado: '',
    fecha_entrega: '',
    linea: '1',
    status: 'activa' as OrderStatus,
  });

  const [pdfName, setPdfName] = useState('');
  const [pdfDataUrl, setPdfDataUrl] = useState('');
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [arrastrando, setArrastrando] = useState(false);
  // true si el PDF se cargó automáticamente del spec (no lo subió el usuario).
  const [pdfDeSpec, setPdfDeSpec] = useState(false);

  // El autollenado corre dentro de un efecto con sus propias dependencias, así
  // que leería un `pdfDataUrl` viejo. Este espejo le da siempre el estado actual
  // del PDF para decidir si puede reemplazarlo al cambiar de spec.
  const pdfRef = useRef({ hay: false, deSpec: false });
  useEffect(() => {
    pdfRef.current = { hay: !!pdfDataUrl, deSpec: pdfDeSpec };
  }, [pdfDataUrl, pdfDeSpec]);

  // Explosión de materiales (opcional, se llena antes de publicar la orden).
  const [corteElementos, setCorteElementos] = useState<ElementoCorte[]>([]);
  const [corteTexto, setCorteTexto] = useState('');
  const [leyendoCorte, setLeyendoCorte] = useState(false);
  const [corteMsg, setCorteMsg] = useState<{ tipo: 'ok' | 'error' | 'info'; texto: string } | null>(null);

  function set(k: string, v: string) {
    setForm(f => ({ ...f, [k]: v }));
  }

  // Semilla inicial de la explosión con la plantilla del tipo de saco (una vez).
  const corteSeed = useRef(false);
  useEffect(() => {
    if (corteSeed.current) return;
    corteSeed.current = true;
    setCorteElementos(elementosDesdePlantilla(form.tipo_saco));
  }, [form.tipo_saco]);

  const cantidadNum = parseInt(form.cantidad, 10) || 0;
  const corteResultado = useMemo(
    () => calcularExplosion(corteElementos, cantidadNum),
    [corteElementos, cantidadNum],
  );

  const corteActualizar = (idx: number, campo: keyof ElementoCorte, valor: string) =>
    setCorteElementos(prev => aplicarCambio(prev, idx, campo, valor));
  const corteAgregar = (el?: ElementoCorte) => setCorteElementos(prev => [...prev, nuevaFila(el)]);
  const corteQuitar = (idx: number) => setCorteElementos(prev => prev.filter((_, i) => i !== idx));

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
      if (!res.ok) {
        setCorteMsg({ tipo: 'error', texto: data?.error ?? 'No se pudo leer el PDF.' });
        return;
      }
      setCorteElementos(data.elementos as ElementoCorte[]);
      setCorteTexto(typeof data.textoCrudo === 'string' ? data.textoCrudo : '');
      mensajeLectura(data.metodo, setCorteMsg);
    } catch {
      setCorteMsg({ tipo: 'error', texto: 'No se pudo conectar con el servidor.' });
    } finally {
      setLeyendoCorte(false);
    }
  }

  // Sugerir el siguiente No. de orden consecutivo (editable) una vez cargados los datos.
  const prefijado = useRef(false);
  useEffect(() => {
    if (prefijado.current || !datosListos) return;
    prefijado.current = true;
    setForm(f =>
      f.numero_orden ? f : { ...f, numero_orden: siguienteNumeroOrden(ordenes.map(o => o.numero_orden)) },
    );
  }, [datosListos, ordenes]);

  // Registro maestro de clientes/specs (tabla `clientes` + `specs` en la base).
  // Alimenta el autocompletado; cliente y spec nuevos se registran solos al crear.
  const [registro, setRegistro] = useState<{ nombre: string; specs: string[] }[]>([]);
  useEffect(() => {
    if (!sesion?.email) return;
    let cancelado = false;
    fetch('/api/clientes', { headers: { 'x-user-email': sesion.email } })
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (!cancelado && data?.clientes) setRegistro(data.clientes);
      })
      .catch(() => {});
    return () => { cancelado = true; };
  }, [sesion?.email]);

  // Autocompletado: registro maestro ∪ clientes de órdenes previas.
  const clientesSugeridos = useMemo(() => {
    const s = new Set<string>();
    for (const c of registro) s.add(c.nombre);
    for (const o of ordenes) {
      const c = o.cliente?.trim();
      if (c) s.add(c);
    }
    return [...s].sort((a, b) => a.localeCompare(b, 'es'));
  }, [registro, ordenes]);

  // Autocompletado de specs: si el cliente capturado está en el registro, se
  // sugieren SUS specs; si no, todos los conocidos (registro + órdenes previas).
  const specsSugeridos = useMemo(() => {
    const cli = form.cliente.trim().toLowerCase();
    const delRegistro = registro.find(c => c.nombre.toLowerCase() === cli);
    if (delRegistro && delRegistro.specs.length > 0) {
      return [...delRegistro.specs].sort((a, b) => a.localeCompare(b, 'es'));
    }
    const delCliente = new Set<string>();
    const todos = new Set<string>();
    for (const c of registro) for (const sp of c.specs) todos.add(sp);
    for (const o of ordenes) {
      const sp = o.spec?.trim();
      if (!sp) continue;
      todos.add(sp);
      if (cli && o.cliente?.trim().toLowerCase() === cli) delCliente.add(sp);
    }
    const base = delCliente.size > 0 ? delCliente : todos;
    return [...base].sort((a, b) => a.localeCompare(b, 'es'));
  }, [registro, ordenes, form.cliente]);

  // ── Autollenado por spec ────────────────────────────────────────────────────
  // Al capturar un spec conocido se cargan sus especificaciones: cliente, tipo
  // de saco, medida, carga, grado, la explosión de materiales y el PDF. La
  // fuente preferida es el DISEÑO registrado en Clientes; si el spec todavía no
  // tiene ficha, se cae a su última orden. Los datos propios de cada orden
  // (número, cantidad, FMF…) no se tocan. Cada spec se aplica una sola vez.
  const ultimoSpecAplicado = useRef('');
  const [origenDatos, setOrigenDatos] = useState<'diseno' | 'orden' | null>(null);
  useEffect(() => {
    const spec = form.spec.trim().toUpperCase();
    if (!sesion?.email || spec.length < 3 || spec === ultimoSpecAplicado.current) return;

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/specs/${encodeURIComponent(spec)}`, {
          headers: { 'x-user-email': sesion.email },
        });
        if (!res.ok) {
          // Spec desconocido: no hay nada que heredar. Si el plano cargado venía
          // de OTRO spec, se quita — una orden nunca debe salir con el diseño de
          // otro producto. Sin aviso: puede ser que aún estén tecleando.
          if (pdfRef.current.deSpec) {
            setPdfDataUrl('');
            setPdfName('');
            setPdfDeSpec(false);
          }
          setOrigenDatos(null);
          return;
        }
        const data = await res.json();
        ultimoSpecAplicado.current = spec;

        type Fuente = {
          tipo_saco: string; medida: string; carga_lbs: number;
          grado: string | null; corte_elementos: ElementoCorte[] | null;
          pdf_url: string | null; pdf_nombre?: string | null;
        };
        // El diseño registrado manda; la última orden es el respaldo.
        const diseno = (data.diseno ?? null) as Fuente | null;
        const ultimaOrden = (data.orden ?? null) as Fuente | null;
        const usable = diseno && (diseno.tipo_saco || diseno.medida || diseno.corte_elementos);
        const o = (usable ? diseno : ultimaOrden) as Fuente | null;
        setOrigenDatos(usable ? 'diseno' : ultimaOrden ? 'orden' : null);
        // El PDF se busca aparte: un diseño puede tener las especificaciones
        // capturadas y todavía no su plano (p. ej. specs viejos), y en ese caso
        // sirve el de la última orden.
        const pdfUrl = diseno?.pdf_url || ultimaOrden?.pdf_url || null;
        const pdfNombre = (diseno?.pdf_url ? diseno.pdf_nombre : ultimaOrden?.pdf_nombre) || '';

        const medidaSep = separarMedida(o?.medida ?? '');
        setForm(f => ({
          ...f,
          cliente: (data.cliente as string) || f.cliente,
          ...(o
            ? {
                tipo_saco: o.tipo_saco || f.tipo_saco,
                medida: medidaSep.dims || f.medida,
                medida_unidad: medidaSep.unidad ?? f.medida_unidad,
                carga_lbs: o.carga_lbs ? String(o.carga_lbs) : f.carga_lbs,
                grado: o.grado || f.grado,
              }
            : {}),
        }));

        if (o) {
          if (o.corte_elementos && o.corte_elementos.length > 0) {
            setCorteElementos(o.corte_elementos);
          }
          setCorteMsg({
            tipo: 'info',
            texto: usable
              ? `Especificaciones cargadas del diseño registrado ${spec} (${data.cliente ?? 'este producto'}). Revisa y ajusta si algo cambió.`
              : `Especificaciones cargadas de la última orden del spec ${spec}. Regístralo como diseño en Clientes para tenerlo siempre listo.`,
          });

          // PDF automático: EL PLANO SIGUE AL SPEC. Si el que está cargado vino
          // de otro spec, se reemplaza; si el spec nuevo no tiene plano, se
          // quita (nunca debe quedar el diseño de otro producto en la orden).
          // Un PDF que el usuario subió a mano sí se respeta.
          const puedeReemplazar = !pdfRef.current.hay || pdfRef.current.deSpec;
          if (puedeReemplazar) {
            if (!pdfUrl) {
              setPdfDataUrl('');
              setPdfName('');
              setPdfDeSpec(false);
              if (pdfRef.current.hay) {
                setPdfError(`El spec ${spec} no tiene PDF registrado. Súbelo aquí.`);
              }
            } else {
              try {
                // El endpoint del PDF es privado: hay que mandar la identidad
                // en el header, igual que el visor.
                const resPdf = await fetch(pdfUrl, { headers: { 'x-user-email': sesion.email } });
                if (!resPdf.ok) {
                  setPdfError('No se pudo traer el PDF de este spec. Súbelo manualmente.');
                } else {
                  const blob = await resPdf.blob();
                  const dataUrl = await new Promise<string>((resolve, reject) => {
                    const r = new FileReader();
                    r.onload = () => resolve(r.result as string);
                    r.onerror = () => reject(r.error);
                    r.readAsDataURL(blob);
                  });
                  setPdfDataUrl(dataUrl);
                  setPdfName(pdfNombre || `${spec}.pdf`);
                  setPdfDeSpec(true);
                  setPdfError(null);
                }
              } catch {
                setPdfError('No se pudo traer el PDF de este spec. Súbelo manualmente.');
              }
            }
          }
        }
      } catch {
        /* sin red: el formulario sigue funcionando manual */
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [form.spec, sesion?.email]);

  // Aviso temprano: el spec capturado pertenece a OTRO cliente (el servidor lo
  // rechazará de todos modos; esto solo avisa antes).
  const specDeOtroCliente = useMemo(() => {
    const sp = form.spec.trim().toUpperCase();
    const cli = form.cliente.trim().toLowerCase();
    if (!sp) return null;
    for (const c of registro) {
      if (c.specs.some(s => s.toUpperCase() === sp) && c.nombre.toLowerCase() !== cli) {
        return c.nombre;
      }
    }
    return null;
  }, [registro, form.spec, form.cliente]);

  // Valida y lee un PDF — lo usan tanto el <input> como soltar el archivo.
  function procesarArchivo(file: File | undefined | null) {
    setPdfError(null);
    setPdfDeSpec(false); // un archivo elegido a mano reemplaza al heredado del spec
    if (!file) { setPdfName(''); setPdfDataUrl(''); return; }

    if (file.type !== 'application/pdf') {
      setPdfError('El archivo debe ser un PDF.');
      setPdfName(''); setPdfDataUrl('');
      return;
    }
    if (file.size > MAX_PDF_BYTES) {
      setPdfError(`El PDF pesa ${(file.size / 1024 / 1024).toFixed(1)} MB. El máximo es ${MAX_MB} MB (límite del navegador).`);
      setPdfName(''); setPdfDataUrl('');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setPdfDataUrl(reader.result as string);
      setPdfName(file.name);
    };
    reader.onerror = () => setPdfError('No se pudo leer el archivo.');
    reader.readAsDataURL(file);
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    procesarArchivo(e.target.files?.[0]);
  }

  function handleDrop(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setArrastrando(false);
    procesarArchivo(e.dataTransfer.files?.[0]);
  }

  // El submit del form solo valida y abre la confirmación; crearOrden hace el POST.
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!pdfDataUrl) {
      setPdfError('Sube el PDF de la orden.');
      return;
    }
    setPdfError(null);
    setConfirmarCrear(true);
  }

  async function crearOrden() {
    setSaving(true);
    setPdfError(null);

    try {
      const res = await fetch('/api/ordenes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-email': sesion?.email ?? '',
        },
        body: JSON.stringify({
          numero_orden: form.numero_orden,
          cliente: form.cliente,
          spec: form.spec,
          medida: combinarMedida(form.medida, form.medida_unidad),
          cantidad: form.cantidad,
          carga_lbs: form.carga_lbs,
          tipo_saco: form.tipo_saco,
          orden_cliente: form.orden_cliente,
          embarcar_a: form.embarcar_a,
          grado: form.grado,
          fecha_entrega: form.fecha_entrega,
          linea: form.linea,
          status: form.status,
          pdf_base64: pdfDataUrl,
          pdf_nombre: pdfName,
          corte_elementos: corteElementos,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPdfError(data?.error ?? 'No se pudo crear la orden.');
        setSaving(false);
        setConfirmarCrear(false);
        return;
      }

      addOrden(data.orden, data.avances);
      setSaving(false);
      setConfirmarCrear(false);
      setSaved(true);
      setTimeout(() => router.push(`/ordenes/${data.orden.id}`), 1000);
    } catch {
      setPdfError('No se pudo conectar con el servidor.');
      setSaving(false);
      setConfirmarCrear(false);
    }
  }

  // ── Estados de carga / permiso ──
  if (!ready) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[40vh] text-sm text-[#6B716C]">
        <Spinner /> Cargando...
      </div>
    );
  }
  if (!allowed) return null; // redirigiendo a /ordenes

  if (saved) {
    return (
      <div className="p-6 max-w-2xl mx-auto flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-brand-green-light flex items-center justify-center mx-auto mb-4">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <circle cx="16" cy="16" r="14" stroke="#009166" strokeWidth="2" />
              <path d="M10 16l4 4 8-8" stroke="#009166" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-[#1A1A1A] mb-1">¡Orden creada!</h2>
          <p className="text-sm text-[#6B716C]">Redirigiendo a la orden...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 max-w-3xl mx-auto pb-12">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/ordenes" className="text-sm text-[#6B716C] hover:text-[#1A1A1A] flex items-center gap-1">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            Órdenes
          </Link>
          <span className="text-[#E2E5E2]">/</span>
          <span className="text-sm text-[#1A1A1A] font-medium">Nueva orden</span>
        </div>
        <h1 className="text-xl font-semibold text-[#1A1A1A]">Nueva orden de producción</h1>
        <p className="text-sm text-[#6B716C] mt-1">
          Captura la carátula y sube el PDF del diseño. El detalle técnico vive en el PDF.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">

        {/* ── Subir PDF ── */}
        <FormSection title="PDF de la orden">
          <label
            htmlFor="pdf"
            onDragEnter={(e) => { e.preventDefault(); setArrastrando(true); }}
            onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }}
            onDragLeave={(e) => { e.preventDefault(); setArrastrando(false); }}
            onDrop={handleDrop}
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
                  {arrastrando ? 'Suelta el PDF aquí' : 'Arrastra el PDF aquí o haz clic para subir'}
                </span>
                <span className="text-xs text-[#8A9A8C]">Solo PDF · máximo {MAX_MB} MB</span>
              </>
            )}
            <input id="pdf" type="file" accept="application/pdf" onChange={handleFile} className="hidden" />
          </label>
          {pdfName && (
            pdfDeSpec ? (
              <p className="text-xs text-[#6B5418] bg-[#FFF7E8] border border-[#E8C88A] rounded-lg px-3 py-2 mt-2">
                📎 PDF cargado automáticamente{' '}
                <span className="font-semibold">
                  {origenDatos === 'diseno' ? 'del diseño registrado de este spec' : 'de la última orden de este spec'}
                </span>.
                Si el diseño tiene una revisión nueva, arrastra el PDF actualizado para reemplazarlo.
              </p>
            ) : (
              <p className="text-xs text-[#6B716C] mt-2">
                Para cambiarlo, arrastra otro PDF o haz clic en el recuadro y elige otro archivo.
              </p>
            )
          )}
          {pdfError && (
            <div className="mt-2 bg-red-50 border border-red-200 text-[#1A1A1A] text-sm rounded-lg px-3.5 py-2.5">
              {pdfError}
            </div>
          )}
        </FormSection>

        {/* ── Carátula ── */}
        <FormSection title="Carátula de la orden">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Field label="No. Orden *" required>
              <input required value={form.numero_orden} onChange={e => set('numero_orden', e.target.value)}
                placeholder="SC001-26CD" className={inputCls} />
              <p className="text-[10px] text-[#8A9A8C] mt-1">Consecutivo sugerido; puedes editarlo.</p>
            </Field>
            <Field label="Cliente *" required>
              <input required list="clientes-list" autoComplete="off" value={form.cliente} onChange={e => set('cliente', e.target.value)}
                placeholder="BULK LIFT" className={inputCls} />
            </Field>
            <Field label="Spec *" required>
              <input required list="specs-list" autoComplete="off" value={form.spec} onChange={e => set('spec', e.target.value)}
                placeholder="MEXQ07354" className={inputCls} />
              {specDeOtroCliente && (
                <p className="text-[11px] text-red-600 mt-1">
                  ⚠ Este spec ya pertenece a <span className="font-semibold">{specDeOtroCliente}</span>. Cada spec es único.
                </p>
              )}
            </Field>
            <Field label="Medida *" required>
              <input required value={form.medida} onChange={e => set('medida', e.target.value)}
                placeholder={form.medida_unidad === 'cm' ? '90 x 90 x 127' : '36 x 36 x 50'}
                className={inputCls} />
            </Field>
            <Field label="Unidad de medida">
              <select value={form.medida_unidad} onChange={e => set('medida_unidad', e.target.value)}
                className={inputCls}>
                <option value="pulg">Pulgadas</option>
                <option value="cm">Centímetros</option>
              </select>
            </Field>
            <Field label="Cantidad (pzas) *" required>
              <input required type="number" min="1" value={form.cantidad} onChange={e => set('cantidad', e.target.value)}
                placeholder="600" className={inputCls} />
            </Field>
            <Field label="Carga (Lbs) *" required>
              <input required type="number" min="1" value={form.carga_lbs} onChange={e => set('carga_lbs', e.target.value)}
                placeholder="2205" className={inputCls} />
            </Field>
            <Field label="Tipo de saco *" required>
              <select value={form.tipo_saco} onChange={e => set('tipo_saco', e.target.value)} className={inputCls}>
                {TIPOS_SACO.map(t => <option key={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="No. Orden Cliente">
              <input value={form.orden_cliente} onChange={e => set('orden_cliente', e.target.value)}
                placeholder="POUS-5053" className={inputCls} />
            </Field>
            <Field label="Embarcar a">
              {/* Hay órdenes que se reparten a varios destinos: un destino por
                  renglón (Enter hace el salto de línea). */}
              <textarea
                rows={3}
                value={form.embarcar_a}
                onChange={e => set('embarcar_a', e.target.value)}
                placeholder={'LAREDO, TX.\nMONTERREY, N.L.'}
                className={`${inputCls} resize-y min-h-[76px] leading-snug`}
              />
              <p className="text-[10px] text-[#8A9A8C] mt-1">Un destino por renglón.</p>
            </Field>
            <Field label="Grado">
              <select value={form.grado} onChange={e => set('grado', e.target.value)} className={inputCls}>
                {GRADOS.map(g => <option key={g} value={g}>{g || '— Sin grado especial —'}</option>)}
              </select>
            </Field>
            <Field label="FMF (Fecha máx. fabricación) *" required>
              <input required type="date" value={form.fecha_entrega} onChange={e => set('fecha_entrega', e.target.value)} className={inputCls} />
            </Field>
          </div>

          {/* Sugerencias de autocompletado (nativas del navegador) */}
          <datalist id="clientes-list">
            {clientesSugeridos.map(c => <option key={c} value={c} />)}
          </datalist>
          <datalist id="specs-list">
            {specsSugeridos.map(s => <option key={s} value={s} />)}
          </datalist>
        </FormSection>

        {/* ── Producción ── */}
        <FormSection title="Producción">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Línea de producción *" required>
              <select value={form.linea} onChange={e => set('linea', e.target.value)} className={inputCls}>
                <option value="1">Línea 1</option>
                <option value="2">Línea 2</option>
              </select>
            </Field>
            <Field label="Status inicial">
              <select value={form.status} onChange={e => set('status', e.target.value as OrderStatus)} className={inputCls}>
                <option value="activa">Activa (lista para capturar)</option>
                <option value="programada">Programada (en cola)</option>
              </select>
            </Field>
          </div>
        </FormSection>

        {/* ── Explosión de materiales (corte) — opcional ── */}
        <FormSection title="Explosión de materiales (corte) — opcional">
          <div className="space-y-3">
            <ExplosionIntro cantidad={cantidadNum} />

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={leerCorteDelPdf}
                disabled={leyendoCorte || !pdfDataUrl}
                title={!pdfDataUrl ? 'Primero sube el PDF arriba' : undefined}
                className="flex items-center gap-1.5 text-xs font-medium text-[#1A1A1A] border border-brand-green/30 hover:bg-brand-green-50 rounded-md px-3 py-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {leyendoCorte ? 'Leyendo PDF…' : 'Leer del PDF'}
              </button>
              <button
                type="button"
                onClick={() => setCorteElementos(elementosDesdePlantilla(form.tipo_saco))}
                className="text-xs font-medium text-[#1A1A1A] border border-[#E2E5E2] hover:bg-[#F6F8F1] rounded-md px-3 py-1.5 transition-colors"
              >
                Reiniciar desde plantilla ({form.tipo_saco})
              </button>
            </div>

            {corteMsg && (
              <div
                className={`text-sm text-[#1A1A1A] rounded-lg border px-3 py-2 ${
                  corteMsg.tipo === 'error'
                    ? 'bg-red-50 border-red-200'
                    : corteMsg.tipo === 'info'
                    ? 'bg-brand-orange-light/40 border-brand-orange/30'
                    : 'bg-brand-green-50 border-brand-green/30'
                }`}
              >
                {corteMsg.texto}
              </div>
            )}

            <TablaCorteEditable
              elementos={corteElementos}
              tipoSaco={form.tipo_saco}
              onActualizar={corteActualizar}
              onAgregar={corteAgregar}
              onQuitar={corteQuitar}
            />
            <TextoLeido texto={corteTexto} />
            <ResultadosExplosion resultado={corteResultado} />
          </div>
        </FormSection>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit" disabled={saving}
            className="flex items-center gap-2 bg-brand-green text-white text-sm font-semibold px-6 py-2.5 rounded-lg hover:bg-brand-green-dark active:scale-[0.98] transition-all disabled:opacity-60 shadow-sm"
          >
            {saving ? (
              <><Spinner /> Guardando...</>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7l4 4 6-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                Crear orden
              </>
            )}
          </button>
          <Link href="/ordenes" className="text-sm text-[#6B716C] hover:text-[#1A1A1A] transition-colors px-4 py-2.5">
            Cancelar
          </Link>
        </div>
      </form>

      {/* Confirmación antes de publicar la orden */}
      <ConfirmModal
        open={confirmarCrear}
        onClose={() => setConfirmarCrear(false)}
        onConfirm={crearOrden}
        titulo="Confirmar orden"
        confirmarTexto="Crear orden"
        cargando={saving}
      >
        <p className="mb-3">Revisa los datos antes de publicar:</p>
        <dl className="space-y-1.5 text-sm">
          <ResumenFila label="No. orden" valor={form.numero_orden} mono />
          <ResumenFila label="Cliente" valor={form.cliente} />
          <ResumenFila label="Spec" valor={form.spec} mono />
          <ResumenFila label="Medida" valor={combinarMedida(form.medida, form.medida_unidad)} mono />
          <ResumenFila label="Cantidad" valor={`${(parseInt(form.cantidad, 10) || 0).toLocaleString()} sacos`} mono />
          <ResumenFila label="Carga" valor={`${(parseInt(form.carga_lbs, 10) || 0).toLocaleString()} lbs`} mono />
          <ResumenFila label="FMF" valor={form.fecha_entrega} />
          <ResumenFila label="Tipo de saco" valor={form.tipo_saco} />
          <ResumenFila label="Orden cliente" valor={form.orden_cliente || '—'} />
          <ResumenFila
            label="Embarcar a"
            valor={form.embarcar_a.split('\n').filter(Boolean).join(' · ') || '—'}
          />
          <ResumenFila label="Grado" valor={form.grado || '—'} />
          <ResumenFila label="Línea" valor={`Línea ${form.linea}`} />
          <ResumenFila label="PDF" valor={pdfName} />
        </dl>
      </ConfirmModal>
    </div>
  );
}

function ResumenFila({ label, valor, mono }: { label: string; valor: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[#8A9A8C] text-xs flex-shrink-0">{label}</dt>
      <dd className={`text-[#1A1A1A] text-right truncate ${mono ? 'font-mono text-xs' : ''}`}>{valor || '—'}</dd>
    </div>
  );
}

const inputCls = 'w-full px-3 py-2 text-sm border border-[#E2E5E2] rounded-lg bg-[#F8FAF8] focus:outline-none focus:ring-1 focus:ring-brand-green focus:border-brand-green transition-colors';

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4 mr-1" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
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
