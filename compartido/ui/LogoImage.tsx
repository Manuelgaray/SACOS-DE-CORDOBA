// Logo de la empresa — usa la imagen real /logo.png (misma del login).
// Reemplaza al antiguo logo de texto para que la marca sea consistente en toda la app.

import Image from 'next/image';

interface Props {
  size?: 'sm' | 'md' | 'lg';
  // Aceptado por compatibilidad con los usos previos. Ya NO dibuja recuadro
  // blanco: el PNG (con fondo transparente) se muestra tal cual sobre el fondo.
  onDark?: boolean;
  className?: string;
}

// El logo original mide 640×336 (≈1.9:1). Mantenemos esa proporción.
const RATIO = 336 / 640;
const WIDTHS: Record<NonNullable<Props['size']>, number> = {
  sm: 150,
  md: 200,
  lg: 300,
};

export default function LogoImage({ size = 'md', className = '' }: Props) {
  const w = WIDTHS[size];
  const h = Math.round(w * RATIO);

  return (
    <div className={`inline-flex ${className}`}>
      <Image
        src="/logo.png"
        alt="Sacos de Córdoba"
        width={w}
        height={h}
        priority
        className="h-auto w-auto object-contain"
        style={{ width: w, height: 'auto' }}
      />
    </div>
  );
}
