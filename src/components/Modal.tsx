'use client';

// ─────────────────────────────────────────────────────────────────────────────
//  Modales con el estilo de la app (tarjeta blanca, bordes suaves, verde marca).
//
//  - Modal:        base con overlay, título y botón ✕ (Escape / clic afuera).
//  - ConfirmModal: pregunta con Cancelar/Confirmar (variante 'marca' o 'peligro').
//  - AlertModal:   aviso de un solo botón ("Entendido").
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect } from 'react';

type Size = 'sm' | 'md' | 'lg';
const SIZE_CLS: Record<Size, string> = {
  sm: 'max-w-md',
  md: 'max-w-xl',
  lg: 'max-w-2xl',
};

export function Modal({
  open,
  onClose,
  title,
  size = 'md',
  bloqueado = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  size?: Size;
  // true mientras se guarda: no deja cerrar con Escape, overlay ni ✕.
  bloqueado?: boolean;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !bloqueado) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, bloqueado, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#143822]/40 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !bloqueado) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`w-full ${SIZE_CLS[size]} max-h-[85vh] overflow-y-auto bg-white rounded-2xl border border-[#E2E5E2] shadow-card animate-modal-in`}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-[#E8EFE9]">
          <h2 className="text-base font-semibold text-[#1A1A1A]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={bloqueado}
            aria-label="Cerrar"
            className="w-7 h-7 flex items-center justify-center rounded-md text-[#8A9A8C] hover:text-[#1A1A1A] hover:bg-[#F6F8F1] transition-colors disabled:opacity-40"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

type Variante = 'marca' | 'peligro';

function IconoVariante({ variante }: { variante: Variante }) {
  if (variante === 'peligro') {
    return (
      <div className="w-11 h-11 rounded-full bg-red-50 border border-red-200 flex items-center justify-center flex-shrink-0">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M10 3L2 17h16L10 3z" stroke="#DC2626" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M10 8.5v3.5" stroke="#DC2626" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="10" cy="14.5" r="0.9" fill="#DC2626" />
        </svg>
      </div>
    );
  }
  return (
    <div className="w-11 h-11 rounded-full bg-brand-green-light flex items-center justify-center flex-shrink-0">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="8" stroke="#009166" strokeWidth="1.5" />
        <path d="M10 6.5v4" stroke="#009166" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="10" cy="13.5" r="0.9" fill="#009166" />
      </svg>
    </div>
  );
}

export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  titulo,
  variante = 'marca',
  confirmarTexto = 'Confirmar',
  cargando = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  titulo: string;
  variante?: Variante;
  confirmarTexto?: string;
  cargando?: boolean;
  children: React.ReactNode;
}) {
  const btnConfirm =
    variante === 'peligro'
      ? 'bg-red-600 hover:bg-red-700'
      : 'bg-brand-green hover:bg-brand-green-dark';

  return (
    <Modal open={open} onClose={onClose} title={titulo} size="sm" bloqueado={cargando}>
      <div className="flex items-start gap-3.5">
        <IconoVariante variante={variante} />
        <div className="text-sm text-[#6B716C] pt-1 min-w-0 flex-1">{children}</div>
      </div>
      <div className="flex items-center justify-end gap-2.5 mt-5">
        <button
          type="button"
          onClick={onClose}
          disabled={cargando}
          className="text-sm font-medium text-[#1A1A1A] border border-[#E2E5E2] hover:bg-[#F6F8F1] rounded-lg px-4 py-2 transition-colors disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={cargando}
          className={`text-sm font-semibold text-white rounded-lg px-4 py-2 transition-colors shadow-sm disabled:opacity-60 ${btnConfirm}`}
        >
          {cargando ? 'Un momento…' : confirmarTexto}
        </button>
      </div>
    </Modal>
  );
}

export function AlertModal({
  open,
  onClose,
  titulo,
  variante = 'peligro',
  children,
}: {
  open: boolean;
  onClose: () => void;
  titulo: string;
  variante?: Variante;
  children: React.ReactNode;
}) {
  return (
    <Modal open={open} onClose={onClose} title={titulo} size="sm">
      <div className="flex items-start gap-3.5">
        <IconoVariante variante={variante} />
        <div className="text-sm text-[#6B716C] pt-1 min-w-0 flex-1">{children}</div>
      </div>
      <div className="flex items-center justify-end mt-5">
        <button
          type="button"
          onClick={onClose}
          className="text-sm font-semibold text-white bg-brand-green hover:bg-brand-green-dark rounded-lg px-4 py-2 transition-colors shadow-sm"
        >
          Entendido
        </button>
      </div>
    </Modal>
  );
}
