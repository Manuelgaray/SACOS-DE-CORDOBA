'use client';

// ─────────────────────────────────────────────────────────────────────────────
//  Input numérico sin el "0 pegado".
//
//  Con un <input type="number"> controlado por un número, el 0 inicial se queda
//  al escribir (queda "049"). Aquí el texto del campo vive en estado local:
//  - valor 0 → campo vacío (placeholder "0");
//  - se puede teclear con naturalidad (incluye decimales a medio escribir);
//  - al salir del campo (blur) se normaliza (quita ceros a la izquierda);
//  - si el valor cambia desde fuera (leer PDF, botones +/−, clamps), se refleja.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';

interface Props {
  valor: number;
  onValor: (texto: string) => void; // recibe el texto crudo; el padre lo parsea
  className?: string;
  min?: number;
  max?: number;
  step?: number | string;
  disabled?: boolean;
}

export default function NumeroInput({ valor, onValor, className, min = 0, max, step, disabled }: Props) {
  const [texto, setTexto] = useState(valor === 0 ? '' : String(valor));

  // Refleja cambios hechos desde FUERA del campo (extracción del PDF, botones
  // +/−, límites aplicados por el padre). Si lo tecleado ya equivale al valor,
  // no tocamos el texto para no estorbar la escritura.
  useEffect(() => {
    const n = parseFloat(texto);
    const tecleado = Number.isFinite(n) ? n : 0;
    if (tecleado !== valor) setTexto(valor === 0 ? '' : String(valor));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valor]);

  return (
    <input
      type="number"
      inputMode="decimal"
      value={texto}
      placeholder="0"
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onChange={(e) => {
        setTexto(e.target.value);
        onValor(e.target.value);
      }}
      onBlur={() => setTexto(valor === 0 ? '' : String(valor))}
      className={className}
    />
  );
}
