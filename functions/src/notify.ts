// Emails are written to the `mail` collection inside the same transaction as
// the change that caused them. The Trigger Email extension sends them and
// records delivery state on each document.
import { Transaction } from 'firebase-admin/firestore';
import { db, fmtLocal, looksLikeEmail, nowIso, Settings, baseUrl } from './common';
import { RequestDoc, UserDoc } from './models';

export interface Recipient { email: string; name: string }

function queue(tx: Transaction, to: string | null | undefined, toName: string, subject: string, text: string, meta: Record<string, unknown>) {
  if (!looksLikeEmail(to)) return;
  tx.set(db.collection('mail').doc(), { to, toName, message: { subject, text }, createdTs: nowIso(), ...meta });
}

export function requestSummary(r: RequestDoc): string {
  return [
    `Reference:   ${r.ref}`,
    `Purpose:     ${r.purpose}`,
    `Destination: ${r.destination}`,
    `Departure:   ${fmtLocal(r.departTs)}`,
    `Return:      ${fmtLocal(r.returnTs)}`,
    `Passengers:  ${r.passengers}`,
  ].join('\n');
}

export type StaffNotice = 'submitted' | 'acknowledged' | 'review' | 'returned' | 'approved' | 'rejected' | 'rescheduled' | 'dispatch' | 'cancelled';

// Email to the requesting staff member. Decisions are presented as coming from
// the Logistics & Transport office, matching the staff status page.
export function notifyStaff(tx: Transaction, s: Settings, id: string, r: RequestDoc, type: StaffNotice, reason?: string | null, dispatch?: { driver: string; vehicle: string }) {
  const leads: Record<StaffNotice, [string, string]> = {
    submitted: ['received', 'Your trip request has been received by the Logistics & Transport Office. You will receive an email as it progresses.'],
    acknowledged: ['acknowledged', 'Your trip request has been received and acknowledged by the Logistics & Transport Office.'],
    review: ['under review', 'Your trip request is under review.'],
    returned: ['returned for correction', 'Your trip request has been returned for correction. Please open your request page (scan your staff QR card) to update and resubmit it.'],
    approved: ['approved', 'Your trip request has been approved. You will be told the driver and vehicle once assigned.'],
    rejected: ['declined', 'Unfortunately your trip request has been declined.'],
    rescheduled: ['rescheduled', 'Your trip request has been rescheduled. Please note the new dates below.'],
    dispatch: ['- vehicle & driver assigned', `A vehicle and driver have been assigned to your trip.\n\nDriver:  ${dispatch?.driver ?? '-'}\nVehicle: ${dispatch?.vehicle ?? '-'}`],
    cancelled: ['cancelled', 'Your trip request has been cancelled.'],
  };
  const [suffix, lead] = leads[type];
  const lines = [`Dear ${r.staff.fullName},`, '', lead];
  if (reason) lines.push('', `Reason / comment: ${reason}`);
  lines.push('', requestSummary(r), '', `Track your request: ${baseUrl(s)}/#r=${r.statusToken}`, '', s.orgName);
  queue(tx, r.staff.email, r.staff.fullName, `Trip request ${r.ref} ${suffix}`, lines.join('\n'), { requestId: id, ref: r.ref, type });
}

export function notifyOffice(tx: Transaction, s: Settings, to: Recipient[], id: string, r: RequestDoc, subject: string, lead: string) {
  for (const u of to) {
    const text = [
      `Dear ${u.name},`, '', lead, '',
      `Requested by: ${r.staff.fullName} (${r.staff.designation}, ${r.staff.unit})`,
      `Priority:     ${r.priority === 'urgent' ? 'URGENT - ' + r.urgentReason : 'Normal'}`,
      requestSummary(r), '',
      `Open in SPIN-KN Fleet: ${baseUrl(s)}/requests/${id}`,
    ].join('\n');
    queue(tx, u.email, u.name, subject, text, { requestId: id, ref: r.ref, type: 'internal' });
  }
}

// Super users hold both office roles, so they get both kinds of email.
export async function officeRecipients(role: 'admin' | 'spc'): Promise<Recipient[]> {
  const snap = await db.collection('users').where('role', 'in', [role, 'super']).where('status', '==', 'active').get();
  return snap.docs.map(d => d.data() as UserDoc).map(u => ({ email: u.email, name: u.name }));
}

export function queueTestEmail(tx: Transaction, to: string, name: string, s: Settings) {
  queue(tx, to, name, 'SPIN-KN Fleet test email', `This is a test email from SPIN-KN Fleet. If you can read this, email is working.\n\n${s.orgName}`, { type: 'test' });
}
