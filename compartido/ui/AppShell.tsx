'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '@/compartido/ui/Sidebar';
import TopBar from '@/compartido/ui/TopBar';
import MobileNav from '@/compartido/ui/MobileNav';
import { ProduccionProvider } from '@/produccion/produccion-store';
import { useSession, logout, sesionVigente } from '@/autenticacion/auth';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { sesion, ready } = useSession();
  const [collapsed, setCollapsed] = useState(false);

  // Protección de rutas (en cliente, porque la sesión vive en localStorage)
  useEffect(() => {
    if (ready && !sesion) router.replace('/login');
  }, [ready, sesion, router]);

  // Una sola sesión activa por usuario: verificamos con el servidor que este
  // dispositivo siga siendo el vigente. Si alguien inició sesión en otro lado,
  // cerramos aquí. Se revisa al montar, cada 30 s y al volver a enfocar la pestaña.
  useEffect(() => {
    if (!ready || !sesion) return;
    let cancelado = false;

    const revisar = async () => {
      const vigente = await sesionVigente(sesion);
      if (!cancelado && !vigente) {
        logout();
        router.replace('/login?motivo=otra-sesion');
      }
    };

    revisar();
    const intervalo = setInterval(revisar, 30_000);
    const onFocus = () => revisar();
    window.addEventListener('focus', onFocus);

    return () => {
      cancelado = true;
      clearInterval(intervalo);
      window.removeEventListener('focus', onFocus);
    };
  }, [ready, sesion, router]);

  // Mientras resolvemos la sesión (o si no hay y aún no redirige) → loader
  if (!ready || !sesion) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F6F8F1] text-sm text-[#6B716C]">
        <svg className="animate-spin h-4 w-4 mr-2" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Cargando...
      </div>
    );
  }

  return (
    <ProduccionProvider>
      <div className="min-h-screen bg-[#F6F8F1] flex flex-col lg:flex-row">
        {/* Sidebar desktop */}
        <div
          className={`hidden lg:block lg:fixed lg:inset-y-0 lg:z-30 transition-all duration-200 ${
            collapsed ? 'lg:w-16' : 'lg:w-56'
          }`}
        >
          <Sidebar
            usuario={sesion}
            email={sesion.email}
            collapsed={collapsed}
            onToggle={() => setCollapsed(c => !c)}
          />
        </div>

        {/* Contenido principal */}
        <div
          className={`flex-1 flex flex-col min-h-screen transition-all duration-200 ${
            collapsed ? 'lg:ml-16' : 'lg:ml-56'
          }`}
        >
          <TopBar usuario={sesion} email={sesion.email} />
          <main className="flex-1 pb-20 lg:pb-6">{children}</main>
        </div>

        {/* Nav móvil */}
        <div className="lg:hidden">
          <MobileNav />
        </div>
      </div>
    </ProduccionProvider>
  );
}
