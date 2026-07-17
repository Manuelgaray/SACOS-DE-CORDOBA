'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { logout, puedeCapturar, type Sesion } from '@/lib/auth';
import { AREAS_FLOW, AREA_LABELS, AREA_COLORS } from '@/lib/mock-data';
import LogoImage from '@/components/LogoImage';
import { ConfirmModal } from '@/components/Modal';

interface Props {
  usuario: Sesion | null;
  email: string;
  collapsed?: boolean;
  onToggle?: () => void;
}

export default function Sidebar({ usuario, email, collapsed = false, onToggle }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [prodOpen, setProdOpen] = useState(pathname.startsWith('/produccion'));
  const [confirmarSalir, setConfirmarSalir] = useState(false);

  function handleLogout() {
    logout();
    router.push('/login');
    router.refresh();
  }

  const navItems = [
    { href: '/dashboard', label: 'Dashboard', icon: DashboardIcon },
    { href: '/ordenes',   label: 'Órdenes',   icon: OrdenesIcon   },
  ];

  const prodActive = pathname === '/produccion' || pathname.startsWith('/produccion/');

  return (
    <aside className="h-full bg-sidebar-bg flex flex-col relative">

      {/* Brand header */}
      <div className={`border-b border-white/10 flex items-center ${collapsed ? 'px-0 py-4 justify-center' : 'px-4 py-4'}`}>
        {collapsed ? (
          <div className="w-8 h-8 rounded-lg bg-brand-orange flex items-center justify-center flex-shrink-0">
            <span className="text-white text-xs font-black">SC</span>
          </div>
        ) : (
          <LogoImage size="sm" onDark />
        )}
      </div>

      {/* Navigation */}
      <nav className={`flex-1 py-4 space-y-1 ${collapsed ? 'px-2' : 'px-3'}`}>
        {!collapsed && (
          <div className="text-[10px] uppercase tracking-wider text-sidebar-text/60 px-3 mb-2 font-medium">
            Menú
          </div>
        )}

        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              onClick={(e) => {
                if (isActive) {
                  e.preventDefault();
                  onToggle?.();
                }
              }}
              className={`flex items-center rounded-lg transition-all duration-150 ${
                collapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-2.5'
              } ${
                isActive
                  ? 'bg-white/15 text-white font-medium shadow-sm'
                  : 'text-sidebar-text hover:bg-white/8 hover:text-white'
              }`}
            >
              <Icon active={isActive} />
              {!collapsed && (
                <>
                  <span className="text-sm">{item.label}</span>
                  {isActive && (
                    <div className="ml-auto w-1.5 h-1.5 rounded-full bg-brand-orange" />
                  )}
                </>
              )}
            </Link>
          );
        })}

        {/* Producción — acordeón con las áreas */}
        <button
          type="button"
          title={collapsed ? 'Producción' : undefined}
          onClick={() => {
            if (collapsed) {
              onToggle?.();          // expandir el sidebar para ver el submenú
              setProdOpen(true);
            } else {
              setProdOpen((o) => !o);
            }
          }}
          className={`w-full flex items-center rounded-lg transition-all duration-150 ${
            collapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-2.5'
          } ${
            prodActive
              ? 'bg-white/15 text-white font-medium shadow-sm'
              : 'text-sidebar-text hover:bg-white/8 hover:text-white'
          }`}
        >
          <ProduccionIcon active={prodActive} />
          {!collapsed && (
            <>
              <span className="text-sm">Producción</span>
              <svg
                width="14" height="14" viewBox="0 0 18 18" fill="none"
                className={`ml-auto transition-transform ${prodOpen ? 'rotate-180' : ''}`}
              >
                <path d="M5 7l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </>
          )}
        </button>

        {!collapsed && prodOpen && (
          <div className="mt-1 ml-3 pl-3 border-l border-white/10 space-y-0.5">
            <Link
              href="/produccion"
              className={`block rounded-md px-3 py-2 text-xs transition-colors ${
                pathname === '/produccion'
                  ? 'bg-white/15 text-white font-medium'
                  : 'text-sidebar-text hover:bg-white/8 hover:text-white'
              }`}
            >
              Resumen
            </Link>
            {AREAS_FLOW.map((area) => {
              const isActive = pathname === `/produccion/${area}`;
              const miArea = usuario?.rol === 'supervisor' && puedeCapturar(usuario, area);
              return (
                <Link
                  key={area}
                  href={`/produccion/${area}`}
                  className={`flex items-center gap-2 rounded-md px-3 py-2 text-xs transition-colors ${
                    isActive
                      ? 'bg-white/15 text-white font-medium'
                      : 'text-sidebar-text hover:bg-white/8 hover:text-white'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${AREA_COLORS[area].bg}`} />
                  <span className="truncate">{AREA_LABELS[area]}</span>
                  {miArea && (
                    <span className="ml-auto text-[9px] uppercase tracking-wide font-semibold text-brand-orange flex-shrink-0">
                      tu área
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        )}

        {/* Usuarios — solo admin */}
        {usuario?.rol === 'admin' && (() => {
          const activo = pathname === '/usuarios' || pathname.startsWith('/usuarios/');
          return (
            <Link
              href="/usuarios"
              title={collapsed ? 'Usuarios' : undefined}
              className={`flex items-center rounded-lg transition-all duration-150 ${
                collapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-2.5'
              } ${
                activo
                  ? 'bg-white/15 text-white font-medium shadow-sm'
                  : 'text-sidebar-text hover:bg-white/8 hover:text-white'
              }`}
            >
              <UsuariosIcon active={activo} />
              {!collapsed && (
                <>
                  <span className="text-sm">Usuarios</span>
                  {activo && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-brand-orange" />}
                </>
              )}
            </Link>
          );
        })()}
      </nav>

      {/* User section */}
      <div className={`border-t border-white/10 py-4 ${collapsed ? 'px-2' : 'px-3'}`}>
        {collapsed ? (
          <>
            {/* Avatar → Mi perfil */}
            <Link
              href="/perfil"
              className="w-8 h-8 rounded-full bg-brand-green flex items-center justify-center mx-auto mb-2 hover:ring-2 hover:ring-white/30 transition-all"
              title={`${usuario?.nombre || email} · Mi perfil`}
            >
              <span className="text-white text-xs font-medium">
                {(usuario?.nombre?.[0] || email[0]).toUpperCase()}
              </span>
            </Link>
            {/* Logout icono */}
            <button
              onClick={() => setConfirmarSalir(true)}
              title="Cerrar sesión"
              className="w-full flex items-center justify-center py-2 text-sidebar-text hover:text-white hover:bg-white/8 rounded-lg transition-colors"
            >
              <LogoutIcon />
            </button>
          </>
        ) : (
          <>
            <Link
              href="/perfil"
              title="Mi perfil"
              className="flex items-center gap-2.5 px-2 py-1.5 mb-2 rounded-lg hover:bg-white/8 transition-colors"
            >
              <div className="w-8 h-8 rounded-full bg-brand-green flex items-center justify-center flex-shrink-0">
                <span className="text-white text-xs font-medium">
                  {(usuario?.nombre?.[0] || email[0]).toUpperCase()}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-white truncate">
                  {usuario?.nombre || email}
                </div>
                <div className="text-[10px] text-sidebar-text capitalize">
                  {usuario?.rol || 'sin rol'}
                  {usuario?.area_asignada && ` · ${usuario.area_asignada}`}
                </div>
              </div>
            </Link>
            <button
              onClick={() => setConfirmarSalir(true)}
              className="w-full flex items-center gap-2 text-left px-3 py-2 text-xs text-sidebar-text hover:text-white hover:bg-white/8 rounded-lg transition-colors"
            >
              <LogoutIcon />
              <span>Cerrar sesión</span>
            </button>
          </>
        )}
      </div>

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
    </aside>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function DashboardIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className="flex-shrink-0">
      <rect x="2" y="2" width="6" height="6" rx="1.5" stroke={active ? '#B8CA5B' : 'currentColor'} strokeWidth="1.5" />
      <rect x="10" y="2" width="6" height="6" rx="1.5" stroke={active ? '#B8CA5B' : 'currentColor'} strokeWidth="1.5" />
      <rect x="2" y="10" width="6" height="6" rx="1.5" stroke={active ? '#B8CA5B' : 'currentColor'} strokeWidth="1.5" />
      <rect x="10" y="10" width="6" height="6" rx="1.5" stroke={active ? '#B8CA5B' : 'currentColor'} strokeWidth="1.5" />
    </svg>
  );
}

function OrdenesIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className="flex-shrink-0">
      <path d="M3 4.5h12M3 9h12M3 13.5h8" stroke={active ? '#B8CA5B' : 'currentColor'} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ProduccionIcon({ active }: { active: boolean }) {
  const c = active ? '#B8CA5B' : 'currentColor';
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className="flex-shrink-0">
      <path d="M2 16V8l5 3V8l5 3V4l4 2v10H2z" stroke={c} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function UsuariosIcon({ active }: { active: boolean }) {
  const c = active ? '#B8CA5B' : 'currentColor';
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className="flex-shrink-0">
      <circle cx="6.5" cy="6" r="2.5" stroke={c} strokeWidth="1.5" />
      <path d="M2 15c0-2.2 2-4 4.5-4S11 12.8 11 15" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
      <path d="M12 4.2a2.3 2.3 0 010 4.1M13.5 14.8c0-1.9-1-3.2-2.3-3.8" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="flex-shrink-0">
      <path d="M5 12H3a1 1 0 01-1-1V3a1 1 0 011-1h2M9 10l3-3-3-3M12 7H5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
