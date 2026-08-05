'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession, updateSession, logout, ROL_LABEL, type Rol } from '@/autenticacion/auth';
import { supabaseNavegador } from '@/autenticacion/supabase-cliente';
import { AREA_LABELS } from '@/compartido/mock-data';

const inputCls =
  'w-full px-3 py-2 text-sm border border-[#E2E5E2] rounded-lg bg-[#F8FAF8] focus:outline-none focus:ring-1 focus:ring-brand-green focus:border-brand-green transition-colors';

export default function PerfilPage() {
  const { sesion, ready } = useSession();
  const router = useRouter();

  const [nombre, setNombre] = useState('');
  const [passActual, setPassActual] = useState('');
  const [passNueva, setPassNueva] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);

  useEffect(() => {
    if (sesion) setNombre(sesion.nombre);
  }, [sesion]);

  if (!ready) return <Cargando />;
  if (!sesion) return null;

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setGuardando(true);
    try {
      const res = await fetch('/api/perfil', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre,
          ...(passNueva ? { password_actual: passActual, password_nueva: passNueva } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ tipo: 'error', texto: data?.error ?? 'No se pudo guardar.' });
        return;
      }
      updateSession({ nombre });

      // Supabase revoca TODAS las sesiones al cambiar la contraseña — incluida
      // la de esta pestaña. Se vuelve a entrar con la contraseña nueva (que el
      // usuario acaba de teclear) para que siga trabajando sin interrupción.
      if (passNueva) {
        const { error } = await supabaseNavegador().auth.signInWithPassword({
          email: sesion!.email,
          password: passNueva,
        });
        if (error) {
          setMsg({
            tipo: 'ok',
            texto: 'Contraseña actualizada. Vuelve a iniciar sesión con la nueva.',
          });
          setTimeout(() => { logout().finally(() => router.replace('/login')); }, 1800);
          return;
        }
      }

      setPassActual('');
      setPassNueva('');
      setMsg({
        tipo: 'ok',
        texto: passNueva
          ? 'Perfil actualizado. Tu contraseña nueva ya está activa.'
          : 'Perfil actualizado.',
      });
    } catch {
      setMsg({ tipo: 'error', texto: 'No se pudo conectar con el servidor.' });
    } finally {
      setGuardando(false);
    }
  }

  const area = sesion.area_asignada
    ? AREA_LABELS[sesion.area_asignada as keyof typeof AREA_LABELS] ?? sesion.area_asignada
    : null;

  return (
    <div className="p-4 lg:p-6 max-w-xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl lg:text-2xl font-semibold text-[#1A1A1A] mb-0.5">Mi perfil</h1>
        <p className="text-sm text-[#6B716C]">Actualiza tu nombre y tu contraseña.</p>
      </div>

      {/* Datos no editables por el usuario */}
      <div className="bg-white border border-[#E2E5E2] rounded-xl shadow-card p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <Dato label="Email" valor={sesion.email} mono />
        <Dato label="Rol" valor={ROL_LABEL[sesion.rol as Rol] ?? sesion.rol} />
        {sesion.rol === 'supervisor' && <Dato label="Área asignada" valor={area ?? '—'} />}
        <p className="sm:col-span-2 text-[11px] text-[#8A9A8C]">
          El email, el rol y el área los administra un administrador.
        </p>
      </div>

      {msg && (
        <div
          className={`text-sm rounded-lg border px-3.5 py-2.5 ${
            msg.tipo === 'error' ? 'bg-red-50 border-red-200 text-[#1A1A1A]' : 'bg-brand-green-50 border-brand-green/30 text-[#1A1A1A]'
          }`}
        >
          {msg.texto}
        </div>
      )}

      <form onSubmit={guardar} className="bg-white border border-[#E2E5E2] rounded-xl shadow-card p-4 space-y-4">
        <div>
          <label className="block text-xs font-medium text-[#1A1A1A] mb-1.5">Nombre</label>
          <input required value={nombre} onChange={(e) => setNombre(e.target.value)} className={inputCls} />
        </div>

        <div className="border-t border-[#F0F5F0] pt-4">
          <p className="text-xs font-semibold text-[#1A1A1A] mb-3">Cambiar contraseña (opcional)</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-[#1A1A1A] mb-1.5">Contraseña actual</label>
              <input
                type="password" value={passActual} onChange={(e) => setPassActual(e.target.value)}
                autoComplete="current-password" placeholder="Tu contraseña actual" className={inputCls}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#1A1A1A] mb-1.5">Nueva contraseña</label>
              <input
                type="password" value={passNueva} onChange={(e) => setPassNueva(e.target.value)}
                autoComplete="new-password" placeholder="Mínimo 4 caracteres" className={inputCls}
              />
            </div>
          </div>
          <p className="text-[11px] text-[#8A9A8C] mt-2">Deja ambos campos en blanco si no quieres cambiar la contraseña.</p>
        </div>

        <button type="submit" disabled={guardando} className="bg-brand-green text-white text-sm font-semibold px-5 py-2 rounded-lg hover:bg-brand-green-dark transition-colors disabled:opacity-60">
          {guardando ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </form>
    </div>
  );
}

function Dato({ label, valor, mono }: { label: string; valor: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-[#8A9A8C]">{label}</div>
      <div className={`text-[#1A1A1A] ${mono ? 'font-mono text-xs' : ''}`}>{valor}</div>
    </div>
  );
}

function Cargando() {
  return (
    <div className="p-6 flex items-center justify-center min-h-[40vh] text-sm text-[#6B716C]">
      <svg className="animate-spin h-4 w-4 mr-2" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      Cargando...
    </div>
  );
}
