// Signed-in user and their role (from Auth custom claims).
import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { onIdTokenChanged, signInWithEmailAndPassword, signOut, User } from 'firebase/auth';
import { auth, call } from './firebase';

// 'super' holds both office roles (admin + SPC).
export type Role = 'admin' | 'spc' | 'driver' | 'super';

export interface Session {
  user: User;
  role: Role | null;
  mustChangePassword: boolean;
}

const Ctx = createContext<{ session: Session | null; ready: boolean }>({ session: null, ready: false });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ session: Session | null; ready: boolean }>({ session: null, ready: false });
  useEffect(() => onIdTokenChanged(auth, async user => {
    if (!user) return setState({ session: null, ready: true });
    const { claims } = await user.getIdTokenResult();
    setState({ session: { user, role: (claims.role as Role) ?? null, mustChangePassword: claims.mustChangePassword === true }, ready: true });
  }), []);
  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);

export function signIn(email: string, password: string) {
  return signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
}

export function signOutNow() {
  location.hash = '';
  return signOut(auth);
}

// Forced first sign-in change: the function sets the password and clears the
// claim. Changing a password ends the current session, so sign straight back
// in with the new password; the fresh token carries the updated claims.
export async function setFirstPassword(password: string) {
  const email = auth.currentUser?.email;
  if (!email) throw new Error('Please sign in again.');
  await call('passwordChanged', { password });
  await signInWithEmailAndPassword(auth, email, password);
}

export function friendlyAuthError(e: unknown): string {
  const code = (e as { code?: string }).code ?? '';
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) return "Those details don't match an account. Check and try again.";
  if (code.includes('too-many-requests')) return 'Too many attempts. Please wait a few minutes and try again.';
  if (code.includes('user-disabled')) return 'This account is inactive. Contact the fleet office.';
  if (code.includes('network')) return 'No connection. Check your network and try again.';
  return (e as Error).message ?? 'Sign-in failed.';
}
