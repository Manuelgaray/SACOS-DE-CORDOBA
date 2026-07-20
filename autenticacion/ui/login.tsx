'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { login } from '@/autenticacion/auth';
import LogoImage from '@/compartido/ui/LogoImage';
import { AlertModal } from '@/compartido/ui/Modal';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState<string | null>(null);
  const [aviso, setAviso]       = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);

  // Aviso cuando la sesión se cerró por iniciar sesión en otro dispositivo.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('motivo') === 'otra-sesion') {
      setAviso('Tu sesión se cerró porque tu cuenta inició sesión en otro dispositivo.');
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const result = await login(email, password);

    if (!result.ok) {
      setError(result.error);
      setLoading(false);
      return;
    }

    router.push('/dashboard');
    router.refresh();
  }

  return (
    <div className="min-h-screen flex">

      {/* ── Panel izquierdo — solo el logo ── */}
      <div className="hidden lg:flex lg:w-[50%] relative flex-col items-center justify-center p-10 bg-white border-r border-[#E2E5E2]">

        {/* Logo */}
        <Image
          src="/logo.png"
          alt="Sacos de Córdoba"
          width={640}
          height={336}
          className="w-[95%] max-w-[660px] h-auto object-contain"
          priority
        />

        {/* Tagline — parte inferior */}
        <p className="absolute bottom-10 left-0 right-0 text-center text-xs text-[#9AA09B] italic tracking-wide">
          &quot;©2026 Sacos de Cordoba Todos los Derechos Reservados&quot;
        </p>
      </div>

      {/* ── Panel derecho — formulario ── */}
      <div className="flex-1 flex items-center justify-center px-4 py-12 bg-[#F6F8F1]">
        <div className="w-full max-w-sm">

          {/* Logo móvil */}
          <div className="lg:hidden flex justify-center mb-8">
            <LogoImage size="md" />
          </div>

          <div className="bg-white rounded-2xl border border-[#E2E5E2] p-7 shadow-card">
            <h2 className="text-lg font-semibold mb-1 text-[#1A1A1A]">Iniciar sesión</h2>
            <p className="text-sm text-[#6B716C] mb-6">Ingresa tus credenciales para continuar</p>

            {aviso && (
              <div className="bg-[#FFF7E8] border border-[#E8C88A] text-[#6B5418] text-sm rounded-lg px-3.5 py-2.5 mb-4 flex items-start gap-2">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="flex-shrink-0 mt-0.5">
                  <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M8 5v3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  <circle cx="8" cy="11.5" r="0.75" fill="currentColor" />
                </svg>
                {aviso}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-xs font-medium text-[#1A1A1A] mb-1.5">
                  Email
                </label>
                <input
                  id="email" type="email" required value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm border border-[#E2E5E2] rounded-lg focus:border-brand-green focus:ring-1 focus:ring-brand-green/20 focus:outline-none transition-colors bg-[#F8FAF8]"
                  placeholder="tu.correo@empresa.com"
                  autoComplete="email"
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-xs font-medium text-[#1A1A1A] mb-1.5">
                  Contraseña
                </label>
                <input
                  id="password" type="password" required value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm border border-[#E2E5E2] rounded-lg focus:border-brand-green focus:ring-1 focus:ring-brand-green/20 focus:outline-none transition-colors bg-[#F8FAF8]"
                  autoComplete="current-password"
                />
              </div>

              <button
                type="submit" disabled={loading}
                className="w-full bg-brand-green text-white text-sm font-semibold py-2.5 rounded-lg hover:bg-brand-green-dark active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Iniciando sesión...
                  </span>
                ) : 'Iniciar sesión'}
              </button>
            </form>
          </div>

          <p className="text-center text-xs text-[#8A9A8C] mt-6">
            ¿Problemas para acceder? Contacta al administrador.
          </p>
        </div>
      </div>

      {/* Error de credenciales */}
      <AlertModal
        open={!!error}
        onClose={() => setError(null)}
        titulo="No se pudo iniciar sesión"
      >
        {error}
      </AlertModal>
    </div>
  );
}
