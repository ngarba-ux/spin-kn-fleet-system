// SPIN-KN Fleet Cloud Functions (region europe-west1).
import { onCall } from 'firebase-functions/v2/https';
import { actor, db, getSettings, Input, log } from './common';
import { queueTestEmail } from './notify';

export { passwordChanged, accountSave, accountToggle, accountResetPassword, driverSave } from './users';
export { staffSave, staffToggle, staffToken } from './staff';
export { requestAction, checkConflicts, staffPortal } from './requests';
export { vehicleSave, vehicleCondition, vehicleServiced, taskSave, taskCancel, tripForceEnd, fuelAdminAdd } from './fleet';
export { onDriverAction } from './driver';

export const emailTest = onCall(async req => {
  const me = actor(req, 'admin');
  const to = new Input(req.data).str('to', 200) ?? (req.auth!.token.email as string);
  const s = await getSettings();
  await db.runTransaction(async tx => {
    queueTestEmail(tx, to, me.name, s);
    log(tx, me, 'Test email queued', to);
  });
  return { ok: true };
});
