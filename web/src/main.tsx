import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { AuthProvider, signOutNow, useAuth } from './auth';
import { ForcedPasswordChange, Login } from './pages/Login';
import { StaffPortal, StatusPage } from './pages/Staff';
import { OfficeApp } from './pages/Office';
import { DriverApp } from './pages/Driver';
import { Alert, Button, Spinner } from './ui';

// Routes (hash-based so QR tokens never reach server logs):
//   #s=<staff QR token>   staff portal, no sign-in
//   #r=<status token>     request status page, no sign-in
//   #/<page>/<id>         signed-in screens
type Route = { kind: 'staff'; token: string } | { kind: 'status'; token: string } | { kind: 'app'; page: string; id: string | null };

function parse(): Route {
  const h = location.hash;
  let m = /^#s=([\w-]+)/.exec(h);
  if (m) return { kind: 'staff', token: m[1] };
  m = /^#r=([\w-]+)/.exec(h);
  if (m) return { kind: 'status', token: m[1] };
  // Email links use /requests/<id>; turn them into hash routes.
  const path = location.pathname.replace(/^\/+/, '');
  const parts = (h.replace(/^#\/?/, '') || path).split('/').filter(Boolean);
  return { kind: 'app', page: parts[0] ?? '', id: parts[1] ? decodeURIComponent(parts[1]) : null };
}

function App() {
  const [route, setRoute] = useState(parse);
  const { session, ready } = useAuth();
  useEffect(() => {
    const on = () => { setRoute(parse()); scrollTo(0, 0); };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);

  if (route.kind === 'staff') return <StaffPortal token={route.token} />;
  if (route.kind === 'status') return <StatusPage token={route.token} />;
  if (!ready) return <Spinner />;
  if (!session) return <Login />;
  if (session.mustChangePassword) return <ForcedPasswordChange />;
  if (session.role === 'driver') return <DriverApp />;
  if (session.role === 'admin' || session.role === 'spc' || session.role === 'super') return <OfficeApp page={route.page} id={route.id} />;
  return (
    <div className="mx-auto max-w-sm space-y-3 p-6">
      <Alert>This account has no role yet. Ask the fleet office to set it up.</Alert>
      <Button variant="secondary" onClick={signOutNow}>Sign out</Button>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider><App /></AuthProvider>
  </StrictMode>,
);
