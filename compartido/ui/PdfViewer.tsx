'use client';

// ─────────────────────────────────────────────────────────────────────────────
//  Visor de PDF universal (funciona también en móvil).
//
//  Los navegadores de teléfono no muestran PDFs incrustados con <object>/<iframe>
//  (mandan a descargar). Aquí renderizamos cada página a un <canvas> con pdf.js,
//  así el plano se ve dentro de la app en cualquier dispositivo.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';
import { getSession } from '@/autenticacion/auth';

const MAX_PAGINAS = 12;      // suficiente para planos/órdenes; evita PDFs enormes
const MAX_PX_ANCHO = 2600;   // tope del lienzo por página (nitidez sin desperdicio)

export default function PdfViewer({ url }: { url: string }) {
  const contRef = useRef<HTMLDivElement>(null);
  const [estado, setEstado] = useState<'cargando' | 'listo' | 'error'>('cargando');

  useEffect(() => {
    let cancelado = false;
    setEstado('cargando');

    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        // El worker se sirve como archivo estático desde /public (lo copia
        // scripts/copy-pdf-worker.mjs antes de cada dev/build, para que su
        // versión siempre coincida con la del paquete instalado).
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

        // El endpoint del PDF exige usuario autenticado (dato sensible):
        // mandamos la identidad de la sesión en el header.
        const doc = await pdfjs.getDocument({
          url,
          httpHeaders: { 'x-user-email': getSession()?.email ?? '' },
        }).promise;
        if (cancelado) return;

        const cont = contRef.current;
        if (!cont) return;
        cont.innerHTML = '';

        const anchoCont = cont.clientWidth || 640;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const paginas = Math.min(doc.numPages, MAX_PAGINAS);

        for (let p = 1; p <= paginas; p++) {
          const page = await doc.getPage(p);
          const base = page.getViewport({ scale: 1 });
          // En pantallas anchas el contenedor puede pasar de 1500 px; con dpr 2
          // el lienzo se dispararía a 3000+ px por página. El tope mantiene el
          // plano nítido sin comerse la memoria en PDFs de varias hojas.
          const anchoPixeles = Math.min(anchoCont * dpr, MAX_PX_ANCHO);
          const viewport = page.getViewport({ scale: anchoPixeles / base.width });

          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          canvas.style.width = '100%';
          canvas.style.height = 'auto';
          canvas.className = 'rounded-lg border border-[#E2E5E2] bg-white mb-3 block';

          const ctx = canvas.getContext('2d');
          if (!ctx) continue;
          await page.render({ canvasContext: ctx, viewport }).promise;
          if (cancelado) return;
          cont.appendChild(canvas);

          // En cuanto la primera página está pintada se quita el spinner: las
          // demás siguen apareciendo abajo mientras el usuario ya la revisa.
          if (p === 1) setEstado('listo');
          // Cede el hilo entre páginas para que la interfaz no se congele
          // mientras se dibujan planos grandes.
          if (p < paginas) await new Promise(r => setTimeout(r, 0));
        }

        await doc.destroy();
        if (!cancelado) setEstado('listo');
      } catch (e) {
        console.error('No se pudo renderizar el PDF:', e);
        if (!cancelado) setEstado('error');
      }
    })();

    return () => {
      cancelado = true;
    };
  }, [url]);

  return (
    <div>
      {estado === 'cargando' && (
        <div className="flex items-center gap-2 text-sm text-[#6B716C] py-8 justify-center">
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Cargando el PDF…
        </div>
      )}
      {estado === 'error' && (
        <p className="text-sm text-[#6B716C] py-4">
          No se pudo mostrar el PDF. Verifica tu sesión e intenta recargar la página.
        </p>
      )}
      <div ref={contRef} />
    </div>
  );
}
