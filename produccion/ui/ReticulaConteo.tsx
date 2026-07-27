'use client';

// ─────────────────────────────────────────────────────────────────────────────
//  Retícula de conteo — el "tachador" de las hojas de papel.
//
//  Varias hojas de la planta cuentan piezas tachando una cuadrícula numerada
//  (mesas de calidad hasta 175, tarimas de prensa hasta 200). Aquí es un
//  marcador: se tacha sola hasta el total y NO se puede editar tocándola, para
//  que el conteo solo suba de uno en uno con el botón "+".
//
//  Los números se acomodan por COLUMNAS, igual que en el papel: la primera
//  columna es 1..filas, la segunda sigue desde ahí, etc.
// ─────────────────────────────────────────────────────────────────────────────

export default function ReticulaConteo({
  total, max, filas, columnas, atenuada,
}: {
  total: number;
  max: number;
  filas: number;
  columnas: number;
  atenuada?: boolean;
}) {
  return (
    <div
      className={`p-1.5 grid gap-px transition-opacity ${atenuada ? 'opacity-40' : ''}`}
      style={{ gridTemplateColumns: `repeat(${columnas}, minmax(0, 1fr))` }}
    >
      {Array.from({ length: filas * columnas }, (_, i) => {
        const fila = Math.floor(i / columnas);
        const col = i % columnas;
        const n = 1 + fila + filas * col;
        // El papel deja huecos cuando la última columna no llega al máximo.
        if (n > max) return <span key={`hueco-${i}`} />;
        const tachado = n <= total;
        return (
          <span
            key={n}
            className={`text-[9px] leading-none py-[3px] rounded-[3px] border tabular-nums text-center select-none ${
              tachado
                ? 'bg-brand-green-light border-brand-green/30 text-[#047150] font-bold line-through'
                : 'bg-white border-[#EEF3EE] text-[#8A9A8C]'
            }`}
          >
            {n}
          </span>
        );
      })}
    </div>
  );
}
