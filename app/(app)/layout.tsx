import AppShell from '@/compartido/ui/AppShell';

// El control de sesión vive en AppShell (cliente), porque la auth local usa
// localStorage. Este layout solo monta el shell.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
