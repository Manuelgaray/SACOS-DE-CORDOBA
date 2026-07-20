'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession, ROL_LABEL, type Rol } from '@/autenticacion/auth';
import { AREAS_FLOW, AREA_LABELS } from '@/compartido/mock-data';
import { Modal, ConfirmModal } from '@/compartido/ui/Modal';

interface Usuario {
  email: string;
  nombre: string;
  rol: string;
  area_asignada: string | null;
}

const inputCls =
  'w-full px-3 py-2 text-sm border border-[#E2E5E2] rounded-lg bg-[#F8FAF8] focus:outline-none focus:ring-1 focus:ring-brand-green focus:border-brand-green transition-colors';

const ROLES: Rol[] = ['admin', 'diseno', 'supervisor'];

export default function UsuariosPage() {
  const router = useRouter();
  const { sesion, ready } = useSession();
  const esAdmin = sesion?.rol === 'admin';

  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [cargando, setCargando] = useState(true);
  const [editando, setEditando] = useState<Usuario | null>(null); // null + formAbierto = crear
  const [formAbierto, setFormAbierto] = useState(false);
  const [aEliminar, setAEliminar] = useState<Usuario | null>(null);
  const [eliminando, setEliminando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);

  useEffect(() => {
    if (ready && !esAdmin) router.replace('/dashboard');
  }, [ready, esAdmin, router]);

  const headers = useCallback(
    () => ({ 'Content-Type': 'application/json', 'x-user-email': sesion?.email ?? '' }),
    [sesion?.email],
  );

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const res = await fetch('/api/usuarios', { headers: headers() });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setUsuarios(data.usuarios as Usuario[]);
    } finally {
      setCargando(false);
    }
  }, [headers]);

  useEffect(() => {
    if (esAdmin) cargar();
  }, [esAdmin, cargar]);

  function abrirCrear() {
    setEditando(null);
    setFormAbierto(true);
    setMsg(null);
  }
  function abrirEditar(u: Usuario) {
    setEditando(u);
    setFormAbierto(true);
    setMsg(null);
  }

  async function eliminar(u: Usuario) {
    setEliminando(true);
    try {
      const res = await fetch(`/api/usuarios/${encodeURIComponent(u.email)}`, {
        method: 'DELETE',
        headers: headers(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ tipo: 'error', texto: data?.error ?? 'No se pudo eliminar.' });
        return;
      }
      setMsg({ tipo: 'ok', texto: `Usuario ${u.email} eliminado.` });
      cargar();
    } catch {
      setMsg({ tipo: 'error', texto: 'No se pudo conectar con el servidor.' });
    } finally {
      setEliminando(false);
      setAEliminar(null);
    }
  }

  async function guardar(payload: FormPayload) {
    const esEdicion = !!editando;
    const url = esEdicion ? `/api/usuarios/${encodeURIComponent(editando!.email)}` : '/api/usuarios';
    const res = await fetch(url, {
      method: esEdicion ? 'PUT' : 'POST',
      headers: headers(),
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { error: (data?.error as string) ?? 'No se pudo guardar.' };
    }
    setMsg({ tipo: 'ok', texto: esEdicion ? 'Usuario actualizado.' : 'Usuario creado.' });
    setFormAbierto(false);
    setEditando(null);
    cargar();
    return { ok: true as const };
  }

  if (!ready || (esAdmin && cargando)) return <Cargando />;
  if (!esAdmin) return null;

  return (
    <div className="p-4 lg:p-6 max-w-4xl mx-auto space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl lg:text-2xl font-semibold text-[#1A1A1A] mb-0.5">Usuarios</h1>
          <p className="text-sm text-[#6B716C]">Crea, edita o elimina las cuentas del sistema.</p>
        </div>
        <button
          onClick={abrirCrear}
          className="bg-brand-green text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-brand-green-dark transition-colors shadow-sm"
        >
          + Nuevo usuario
        </button>
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

      {/* Crear / editar en modal */}
      <Modal
        open={formAbierto}
        onClose={() => { setFormAbierto(false); setEditando(null); }}
        title={editando ? 'Editar usuario' : 'Nuevo usuario'}
        size="md"
      >
        <UsuarioForm
          key={editando?.email ?? 'nuevo'}
          editando={editando}
          onCancelar={() => { setFormAbierto(false); setEditando(null); }}
          onGuardar={guardar}
        />
      </Modal>

      {/* Confirmación de eliminación */}
      <ConfirmModal
        open={!!aEliminar}
        onClose={() => setAEliminar(null)}
        onConfirm={() => aEliminar && eliminar(aEliminar)}
        titulo="Eliminar usuario"
        variante="peligro"
        confirmarTexto="Eliminar"
        cargando={eliminando}
      >
        ¿Eliminar a <span className="font-semibold text-[#1A1A1A]">{aEliminar?.nombre}</span>{' '}
        (<span className="font-mono text-xs">{aEliminar?.email}</span>)?
        <br />Esta acción no se puede deshacer.
      </ConfirmModal>

      <div className="bg-white border border-[#E2E5E2] rounded-xl shadow-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-[#8A9A8C] border-b border-[#E8EFE9]">
                <th className="py-2.5 px-4 font-medium">Nombre</th>
                <th className="py-2.5 px-4 font-medium">Email</th>
                <th className="py-2.5 px-4 font-medium">Rol</th>
                <th className="py-2.5 px-4 font-medium">Área</th>
                <th className="py-2.5 px-4 font-medium text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0F5F0]">
              {usuarios.map((u) => (
                <tr key={u.email} className="hover:bg-[#F8FAF8]">
                  <td className="py-2.5 px-4 font-medium text-[#1A1A1A]">
                    {u.nombre}
                    {u.email === sesion?.email && <span className="ml-2 text-[10px] text-[#8A9A8C]">(tú)</span>}
                  </td>
                  <td className="py-2.5 px-4 text-[#6B716C] font-mono text-xs">{u.email}</td>
                  <td className="py-2.5 px-4">
                    <span className="text-xs px-2 py-0.5 rounded-md bg-[#F0F5F0] text-[#1A1A1A]">
                      {ROL_LABEL[u.rol as Rol] ?? u.rol}
                    </span>
                  </td>
                  <td className="py-2.5 px-4 text-[#6B716C] text-xs">
                    {u.rol === 'supervisor' ? (u.area_asignada ? AREA_LABELS[u.area_asignada as keyof typeof AREA_LABELS] ?? u.area_asignada : '—') : '—'}
                  </td>
                  <td className="py-2.5 px-4 text-right whitespace-nowrap">
                    <button onClick={() => abrirEditar(u)} className="text-xs font-medium text-[#1A1A1A] border border-[#E2E5E2] hover:bg-[#F6F8F1] rounded-md px-2.5 py-1 transition-colors">
                      Editar
                    </button>
                    <button
                      onClick={() => setAEliminar(u)}
                      disabled={u.email === sesion?.email}
                      title={u.email === sesion?.email ? 'No puedes eliminar tu propia cuenta' : undefined}
                      className="ml-2 text-xs font-medium text-red-600 border border-red-200 hover:bg-red-50 rounded-md px-2.5 py-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Eliminar
                    </button>
                  </td>
                </tr>
              ))}
              {usuarios.length === 0 && (
                <tr><td colSpan={5} className="py-6 text-center text-sm text-[#8A9A8C]">No hay usuarios.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

interface FormPayload {
  email?: string;
  nombre: string;
  rol: string;
  area_asignada: string | null;
  password?: string;
}

function UsuarioForm({
  editando,
  onCancelar,
  onGuardar,
}: {
  editando: Usuario | null;
  onCancelar: () => void;
  onGuardar: (p: FormPayload) => Promise<{ ok: true } | { error: string }>;
}) {
  const esEdicion = !!editando;
  const [email, setEmail] = useState(editando?.email ?? '');
  const [nombre, setNombre] = useState(editando?.nombre ?? '');
  const [rol, setRol] = useState<string>(editando?.rol ?? 'supervisor');
  const [area, setArea] = useState<string>(editando?.area_asignada ?? 'corte');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setGuardando(true);
    const payload: FormPayload = {
      nombre,
      rol,
      area_asignada: rol === 'supervisor' ? area : null,
      ...(esEdicion ? {} : { email }),
      ...(password ? { password } : {}),
    };
    const res = await onGuardar(payload);
    setGuardando(false);
    if ('error' in res) setError(res.error);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Campo label="Email *">
          <input
            type="email" required value={email} disabled={esEdicion}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="persona@sacos.com"
            className={`${inputCls} ${esEdicion ? 'opacity-60 cursor-not-allowed' : ''}`}
          />
          {esEdicion && <p className="text-[10px] text-[#8A9A8C] mt-1">El email es el identificador de acceso y no se puede cambiar.</p>}
        </Campo>
        <Campo label="Nombre *">
          <input required value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre y apellido" className={inputCls} />
        </Campo>
        <Campo label="Rol *">
          <select value={rol} onChange={(e) => setRol(e.target.value)} className={inputCls}>
            {ROLES.map((r) => <option key={r} value={r}>{ROL_LABEL[r]}</option>)}
          </select>
        </Campo>
        {rol === 'supervisor' && (
          <Campo label="Área asignada *">
            <select value={area} onChange={(e) => setArea(e.target.value)} className={inputCls}>
              {AREAS_FLOW.map((a) => <option key={a} value={a}>{AREA_LABELS[a]}</option>)}
            </select>
          </Campo>
        )}
        <Campo label={esEdicion ? 'Nueva contraseña' : 'Contraseña *'}>
          <input
            type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            required={!esEdicion}
            placeholder={esEdicion ? 'Dejar en blanco para no cambiar' : 'Mínimo 4 caracteres'}
            autoComplete="new-password"
            className={inputCls}
          />
        </Campo>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-[#1A1A1A] text-sm rounded-lg px-3.5 py-2.5">{error}</div>}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={guardando} className="bg-brand-green text-white text-sm font-semibold px-5 py-2 rounded-lg hover:bg-brand-green-dark transition-colors disabled:opacity-60">
          {guardando ? 'Guardando…' : esEdicion ? 'Guardar cambios' : 'Crear usuario'}
        </button>
        <button type="button" onClick={onCancelar} className="text-sm text-[#6B716C] hover:text-[#1A1A1A] px-3 py-2">
          Cancelar
        </button>
      </div>
    </form>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-[#1A1A1A] mb-1.5">{label}</label>
      {children}
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
      Cargando usuarios...
    </div>
  );
}
