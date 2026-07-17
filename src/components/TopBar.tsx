'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { logout } from '@/lib/auth';
import LogoImage from '@/components/LogoImage';
import { ConfirmModal } from '@/components/Modal';

interface Props {
  usuario: { nombre?: string; rol?: string } | null;
  email: string;
}

export default function TopBar({ usuario, email }: Props) {
  const router = useRouter();
  const [confirmarSalir, setConfirmarSalir] = useState(false);

  function handleLogout() {
    logout();
    router.push('/login');
    router.refresh();
  }

  return (
    <header className="lg:hidden bg-sidebar-bg px-4 py-3 flex items-center justify-between sticky top-0 z-20">
      <div className="flex items-center gap-3">
        <LogoImage size="sm" onDark />
        <div className="w-px h-6 bg-white/20" />
        <Link href="/perfil" className="text-[11px] text-white/60 hover:text-white truncate max-w-[140px] transition-colors" title="Mi perfil">
          {usuario?.nombre || email}
        </Link>
      </div>
      <button
        onClick={() => setConfirmarSalir(true)}
        className="text-xs text-white/80 px-3 py-1.5 border border-white/20 rounded-md hover:bg-white/10 transition-colors"
      >
        Salir
      </button>

      {/* Confirmación de cierre de sesión */}
      <ConfirmModal
        open={confirmarSalir}
        onClose={() => setConfirmarSalir(false)}
        onConfirm={handleLogout}
        titulo="Cerrar sesión"
        confirmarTexto="Cerrar sesión"
      >
        ¿Seguro que quieres cerrar tu sesión?
      </ConfirmModal>
    </header>
  );
}
