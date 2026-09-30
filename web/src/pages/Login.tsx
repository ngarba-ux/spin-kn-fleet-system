import { FormEvent, useState } from 'react';
import { friendlyAuthError, setFirstPassword, signIn, signOutNow } from '../auth';
import { Alert, Button, Card, Field, inputCls, Logo, useAction } from '../ui';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await signIn(email, password); }
    catch (err) { setError(friendlyAuthError(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-4 py-10">
      <Logo />
      <Card>
        <form onSubmit={submit} className="space-y-4">
          <h1 className="text-lg font-semibold">Sign in</h1>
          <Field label="Email"><input className={inputCls} type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required /></Field>
          <Field label="Password"><input className={inputCls} type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></Field>
          {error && <Alert>{error}</Alert>}
          <Button type="submit" busy={busy} className="w-full">Sign in</Button>
        </form>
      </Card>
      <p className="text-center text-xs text-slate-500">Staff: scan the QR code on your staff ID card to request a vehicle.</p>
    </div>
  );
}

export function ForcedPasswordChange() {
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const { busy, error, setError, run } = useAction();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (pw.length < 8) return setError('Password must be at least 8 characters.');
    if (pw !== again) return setError('The two passwords do not match.');
    run(() => setFirstPassword(pw));
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-4 py-10">
      <Logo />
      <Card>
        <form onSubmit={submit} className="space-y-4">
          <h1 className="text-lg font-semibold">Choose your password</h1>
          <p className="text-sm text-slate-600">For security, set a new password before you continue. Use at least 8 characters.</p>
          <Field label="New password"><input className={inputCls} type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} required /></Field>
          <Field label="Repeat new password"><input className={inputCls} type="password" autoComplete="new-password" value={again} onChange={e => setAgain(e.target.value)} required /></Field>
          {error && <Alert>{error}</Alert>}
          <Button type="submit" busy={busy} className="w-full">Save password</Button>
          <Button type="button" variant="ghost" className="w-full" onClick={signOutNow}>Sign out</Button>
        </form>
      </Card>
    </div>
  );
}
