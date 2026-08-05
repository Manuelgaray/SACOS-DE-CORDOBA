'use client';

import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { type Orden, type OrderStatus, type ElementoCorte } from '@/compartido/mock-data';
import { type AvanceArea } from '@/produccion/produccion';
import { getSession } from '@/autenticacion/auth';

// Cada cuánto se vuelve a preguntar por órdenes y avances mientras la pestaña
// está a la vista. Con la pestaña en segundo plano no se consulta nada.
const REFRESCO_MS = 20_000;

interface Ctx {
  ordenes: Orden[];
  avances: Record<string, AvanceArea[]>;
  estados: Record<string, OrderStatus>;
  ready: boolean;
  /** Vuelve a leer del servidor (lo usan las pantallas tras guardar algo). */
  refrescar: () => void;
  /** Trae una orden que no esté en el conjunto de trabajo (histórico). */
  cargarOrden: (ordenId: string) => Promise<boolean>;
  setHecho: (ordenId: string, area: string, compIdx: number, valor: number) => void;
  setEstado: (ordenId: string, estado: OrderStatus) => void;
  addOrden: (orden: Orden, avances: AvanceArea[]) => void;
  setCorteElementos: (ordenId: string, elementos: ElementoCorte[]) => void;
  setAvancesOrden: (ordenId: string, avances: AvanceArea[]) => void;
  patchOrden: (ordenId: string, patch: Partial<Orden>) => void;
}

const ProduccionContext = createContext<Ctx | null>(null);

export function ProduccionProvider({ children }: { children: React.ReactNode }) {
  const [ordenes, setOrdenes] = useState<Orden[]>([]);
  const [avances, setAvances] = useState<Record<string, AvanceArea[]>>({});
  const [estados, setEstados] = useState<Record<string, OrderStatus>>({});
  const [ready, setReady] = useState(false);

  // Debounce por componente: la pantalla se actualiza al instante, pero el POST
  // (y por tanto el renglón en la bitácora de reportes) se manda hasta que el
  // supervisor deja de teclear ~0.8 s — así no se genera un reporte por tecla.
  const timersHecho = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  // ── Datos siempre frescos ───────────────────────────────────────────────────
  // El proveedor vive en el shell de la app, así que NO se vuelve a montar al
  // navegar entre secciones: sin esto, lo que otro usuario crea o captura no
  // aparecería hasta recargar la página con F5.
  const cargando = useRef(false);

  const refrescar = useCallback(async () => {
    // Si el supervisor está tecleando avances hay escrituras en cola: traer del
    // servidor ahora le regresaría el número viejo a media captura.
    if (cargando.current || timersHecho.current.size > 0) return;
    cargando.current = true;
    try {
      const res = await fetch('/api/data', { cache: 'no-store' });
      if (!res.ok) throw new Error('No se pudieron cargar los datos');
      const data = (await res.json()) as { ordenes: Orden[]; avances: Record<string, AvanceArea[]> };
      setOrdenes(data.ordenes);
      setAvances(data.avances);
      // `estados` es el override local del status. Se limpian los que el
      // servidor ya confirmó; si quedara alguno en vuelo, se respeta.
      setEstados(prev => {
        const servidor = new Map(data.ordenes.map(o => [o.id, o.status]));
        const next: Record<string, OrderStatus> = {};
        for (const [id, st] of Object.entries(prev)) {
          if (servidor.get(id) !== st) next[id] = st;
        }
        return next;
      });
    } catch (e) {
      // Sin red se conserva lo que ya está en pantalla: la planta sigue viendo
      // sus órdenes aunque el servidor parpadee.
      console.error('Error cargando datos de producción:', e);
    } finally {
      cargando.current = false;
      setReady(true);
    }
  }, []);

  useEffect(() => {
    refrescar();

    // Al volver a la pestaña se refresca de inmediato; mientras esté a la vista,
    // cada REFRESCO_MS. En segundo plano no se consulta nada.
    const alVolver = () => {
      if (document.visibilityState === 'visible') refrescar();
    };
    const intervalo = setInterval(alVolver, REFRESCO_MS);
    document.addEventListener('visibilitychange', alVolver);
    window.addEventListener('focus', alVolver);
    window.addEventListener('online', alVolver);

    return () => {
      clearInterval(intervalo);
      document.removeEventListener('visibilitychange', alVolver);
      window.removeEventListener('focus', alVolver);
      window.removeEventListener('online', alVolver);
    };
  }, [refrescar]);

  const setHecho = useCallback((ordenId: string, area: string, compIdx: number, valor: number) => {
    // Update optimista en pantalla (incluye la marca del último reporte)...
    const sesion = getSession();
    setAvances(prev => {
      const arr = prev[ordenId];
      if (!arr) return prev;
      const next = arr.map(av => {
        if (av.area !== area) return av;
        return {
          ...av,
          ultimoReporte: { fecha: new Date().toISOString(), usuario: sesion?.nombre ?? null },
          componentes: av.componentes.map((c, i) => {
            if (i !== compIdx) return c;
            const v = Math.max(0, Math.min(c.meta, Math.round(valor || 0)));
            return { ...c, hecho: v };
          }),
        };
      });
      return { ...prev, [ordenId]: next };
    });

    // ...y persistir en la base (con debounce). El header identifica al usuario
    // para validar permisos y firmar el reporte en la bitácora.
    const clave = `${ordenId}|${area}|${compIdx}`;
    const previo = timersHecho.current.get(clave);
    if (previo) clearTimeout(previo);
    timersHecho.current.set(
      clave,
      setTimeout(() => {
        timersHecho.current.delete(clave);
        fetch('/api/avances', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ordenId, area, compIdx, valor }),
          keepalive: true,
        })
          .then(res => res.json().catch(() => ({})).then(data => {
            if (!res.ok) {
              console.error('Captura rechazada:', data?.error ?? res.status);
              return;
            }
            // El servidor cierra la orden sola si todas las áreas llegaron al
            // 100 %: lo reflejamos en pantalla sin recargar.
            if (data?.ordenTerminada) {
              setOrdenes(prev => prev.map(o => (o.id === ordenId
                ? { ...o, status: 'terminada' as OrderStatus, fecha_fin: data.fechaFin ?? o.fecha_fin }
                : o)));
              setEstados(prev => ({ ...prev, [ordenId]: 'terminada' }));
            }
          }))
          .catch(e => console.error('No se pudo guardar el avance:', e));
      }, 800),
    );
  }, []);

  const setEstado = useCallback((ordenId: string, estado: OrderStatus) => {
    // Guardamos el estado previo para poder REVERTIR si el servidor rechaza
    // (p. ej. un usuario sin permiso de admin): la pantalla no debe mentir.
    let previo: OrderStatus | undefined;
    setOrdenes(prev => prev.map(o => {
      if (o.id !== ordenId) return o;
      previo = o.status;
      return { ...o, status: estado };
    }));
    setEstados(prev => ({ ...prev, [ordenId]: estado }));

    // Solo un admin puede cambiar el estado: el servidor lo valida con este header.
    fetch(`/api/ordenes/${ordenId}/estado`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado }),
    })
      .then(async res => {
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          // El servidor fija las fechas reales de inicio/fin (calendario).
          setOrdenes(prev => prev.map(o => (o.id === ordenId
            ? { ...o, fecha_inicio: data.fecha_inicio ?? o.fecha_inicio, fecha_fin: data.fecha_fin ?? null }
            : o)));
          return;
        }
        console.error('Cambio de estado rechazado:', data?.error ?? res.status);
        if (previo !== undefined) {
          const anterior = previo;
          setOrdenes(prev => prev.map(o => (o.id === ordenId ? { ...o, status: anterior } : o)));
          setEstados(prev => ({ ...prev, [ordenId]: anterior }));
        }
      })
      .catch(e => console.error('No se pudo guardar el estado:', e));
  }, []);

  // Actualiza campos sueltos de una orden en pantalla (p. ej. tras autorizarla
  // o cuando el servidor la cierra sola al completarse todas las áreas).
  const patchOrden = useCallback((ordenId: string, patch: Partial<Orden>) => {
    setOrdenes(prev => prev.map(o => (o.id === ordenId ? { ...o, ...patch } : o)));
    // El mapa `estados` es el override local del status: si el patch trae uno
    // nuevo, hay que actualizarlo también para no mostrar el anterior.
    if (patch.status) {
      const s = patch.status;
      setEstados(prev => ({ ...prev, [ordenId]: s }));
    }
  }, []);

  // El store solo trae el conjunto de trabajo. Al abrir una orden vieja del
  // histórico, la pantalla la pide por id y aquí se suma a lo que hay en memoria.
  const cargarOrden = useCallback(async (ordenId: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/ordenes/${encodeURIComponent(ordenId)}`, {
        cache: 'no-store',
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { orden: Orden; avances: AvanceArea[] };
      setOrdenes(prev => (prev.some(o => o.id === data.orden.id) ? prev : [...prev, data.orden]));
      setAvances(prev => ({ ...prev, [data.orden.id]: data.avances }));
      return true;
    } catch {
      return false;
    }
  }, []);

  // La orden ya fue creada en el servidor; aquí solo la reflejamos en pantalla.
  const addOrden = useCallback((orden: Orden, avancesOrden: AvanceArea[]) => {
    setOrdenes(prev => [orden, ...prev]);
    setAvances(prev => ({ ...prev, [orden.id]: avancesOrden }));
  }, []);

  // Refleja en pantalla los elementos de corte ya guardados en el servidor (PUT).
  const setCorteElementos = useCallback((ordenId: string, elementos: ElementoCorte[]) => {
    setOrdenes(prev => prev.map(o => (o.id === ordenId ? { ...o, corte_elementos: elementos } : o)));
  }, []);

  // Refleja los avances re-sincronizados por el servidor al guardar la
  // explosión: TODAS las áreas derivan sus puntos de los elementos de la orden.
  const setAvancesOrden = useCallback((ordenId: string, avancesOrden: AvanceArea[]) => {
    setAvances(prev => ({ ...prev, [ordenId]: avancesOrden }));
  }, []);

  return (
    <ProduccionContext.Provider value={{ ordenes, avances, estados, ready, refrescar, cargarOrden, setHecho, setEstado, addOrden, setCorteElementos, setAvancesOrden, patchOrden }}>
      {children}
    </ProduccionContext.Provider>
  );
}

export function useProduccion() {
  const ctx = useContext(ProduccionContext);
  if (!ctx) throw new Error('useProduccion debe usarse dentro de ProduccionProvider');
  return ctx;
}
