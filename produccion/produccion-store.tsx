'use client';

import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { type Orden, type OrderStatus, type ElementoCorte } from '@/compartido/mock-data';
import { type AvanceArea } from '@/produccion/produccion';
import { getSession } from '@/autenticacion/auth';

interface Ctx {
  ordenes: Orden[];
  avances: Record<string, AvanceArea[]>;
  estados: Record<string, OrderStatus>;
  ready: boolean;
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

  // Cargar órdenes y avances desde PostgreSQL (vía /api/data).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/data');
        if (!res.ok) throw new Error('No se pudieron cargar los datos');
        const data = (await res.json()) as { ordenes: Orden[]; avances: Record<string, AvanceArea[]> };
        if (cancelled) return;
        setOrdenes(data.ordenes);
        setAvances(data.avances);
      } catch (e) {
        console.error('Error cargando datos de producción:', e);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounce por componente: la pantalla se actualiza al instante, pero el POST
  // (y por tanto el renglón en la bitácora de reportes) se manda hasta que el
  // supervisor deja de teclear ~0.8 s — así no se genera un reporte por tecla.
  const timersHecho = useRef(new Map<string, ReturnType<typeof setTimeout>>());

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
          headers: {
            'Content-Type': 'application/json',
            'x-user-email': getSession()?.email ?? '',
          },
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
      headers: {
        'Content-Type': 'application/json',
        'x-user-email': getSession()?.email ?? '',
      },
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
    <ProduccionContext.Provider value={{ ordenes, avances, estados, ready, setHecho, setEstado, addOrden, setCorteElementos, setAvancesOrden, patchOrden }}>
      {children}
    </ProduccionContext.Provider>
  );
}

export function useProduccion() {
  const ctx = useContext(ProduccionContext);
  if (!ctx) throw new Error('useProduccion debe usarse dentro de ProduccionProvider');
  return ctx;
}
