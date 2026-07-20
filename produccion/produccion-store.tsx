'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { type Orden, type OrderStatus, type ElementoCorte } from '@/compartido/mock-data';
import { type AvanceArea, type ComponenteProduccion } from '@/produccion/produccion';
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
  setAvanceCorte: (ordenId: string, componentes: ComponenteProduccion[]) => void;
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

  const setHecho = useCallback((ordenId: string, area: string, compIdx: number, valor: number) => {
    // Update optimista en pantalla...
    setAvances(prev => {
      const arr = prev[ordenId];
      if (!arr) return prev;
      const next = arr.map(av => {
        if (av.area !== area) return av;
        return {
          ...av,
          componentes: av.componentes.map((c, i) => {
            if (i !== compIdx) return c;
            const v = Math.max(0, Math.min(c.meta, Math.round(valor || 0)));
            return { ...c, hecho: v };
          }),
        };
      });
      return { ...prev, [ordenId]: next };
    });
    // ...y persistir en la base de datos. El header identifica al usuario para que
    // el servidor valide el permiso de captura por área (defensa en profundidad).
    fetch('/api/avances', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-email': getSession()?.email ?? '',
      },
      body: JSON.stringify({ ordenId, area, compIdx, valor }),
    }).catch(e => console.error('No se pudo guardar el avance:', e));
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
        if (res.ok) return;
        const data = await res.json().catch(() => ({}));
        console.error('Cambio de estado rechazado:', data?.error ?? res.status);
        if (previo !== undefined) {
          const anterior = previo;
          setOrdenes(prev => prev.map(o => (o.id === ordenId ? { ...o, status: anterior } : o)));
          setEstados(prev => ({ ...prev, [ordenId]: anterior }));
        }
      })
      .catch(e => console.error('No se pudo guardar el estado:', e));
  }, []);

  // Actualiza campos sueltos de una orden en pantalla (p. ej. tras autorizarla).
  const patchOrden = useCallback((ordenId: string, patch: Partial<Orden>) => {
    setOrdenes(prev => prev.map(o => (o.id === ordenId ? { ...o, ...patch } : o)));
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

  // Refleja la captura de Corte re-sincronizada por el servidor al guardar la
  // explosión (los elementos de la orden SON lo que se captura en Corte).
  const setAvanceCorte = useCallback((ordenId: string, componentes: ComponenteProduccion[]) => {
    setAvances(prev => {
      const arr = prev[ordenId];
      if (!arr) return prev;
      return {
        ...prev,
        [ordenId]: arr.map(av => (av.area === 'corte' ? { ...av, componentes } : av)),
      };
    });
  }, []);

  return (
    <ProduccionContext.Provider value={{ ordenes, avances, estados, ready, setHecho, setEstado, addOrden, setCorteElementos, setAvanceCorte, patchOrden }}>
      {children}
    </ProduccionContext.Provider>
  );
}

export function useProduccion() {
  const ctx = useContext(ProduccionContext);
  if (!ctx) throw new Error('useProduccion debe usarse dentro de ProduccionProvider');
  return ctx;
}
