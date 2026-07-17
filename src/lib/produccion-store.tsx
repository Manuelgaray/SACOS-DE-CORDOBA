'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { type Orden, type OrderStatus, type ElementoCorte } from './mock-data';
import { type AvanceArea } from './produccion';
import { getSession } from './auth';

interface Ctx {
  ordenes: Orden[];
  avances: Record<string, AvanceArea[]>;
  estados: Record<string, OrderStatus>;
  ready: boolean;
  setHecho: (ordenId: string, area: string, compIdx: number, valor: number) => void;
  setEstado: (ordenId: string, estado: OrderStatus) => void;
  addOrden: (orden: Orden, avances: AvanceArea[]) => void;
  setCorteElementos: (ordenId: string, elementos: ElementoCorte[]) => void;
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
    setEstados(prev => ({ ...prev, [ordenId]: estado }));
    setOrdenes(prev => prev.map(o => (o.id === ordenId ? { ...o, status: estado } : o)));
    fetch(`/api/ordenes/${ordenId}/estado`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado }),
    }).catch(e => console.error('No se pudo guardar el estado:', e));
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

  return (
    <ProduccionContext.Provider value={{ ordenes, avances, estados, ready, setHecho, setEstado, addOrden, setCorteElementos }}>
      {children}
    </ProduccionContext.Provider>
  );
}

export function useProduccion() {
  const ctx = useContext(ProduccionContext);
  if (!ctx) throw new Error('useProduccion debe usarse dentro de ProduccionProvider');
  return ctx;
}
