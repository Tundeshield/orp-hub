import { doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db } from '../firebase.js';
import { addAudit, addNotify } from './db.js';
import { fmtDateTime } from './dates.js';
import { bcol, bdoc } from './db.js';

function bookInto(batch, profile, slot, details) {
  const apptRef = doc(bcol('appointments'));
  batch.set(apptRef, {
    slotId: slot.id, start: slot.start, end: slot.end,
    bookedBy: profile.uid, bookedByName: profile.name,
    attendeeUid: 'attendeeUid' in details ? details.attendeeUid : profile.uid,
    attendeeName: details.attendeeName || profile.name,
    phone: details.phone || '', purpose: details.purpose || '', location: details.location || '',
    status: 'booked', rescheduledFrom: details.rescheduledFrom || null,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  batch.update(bdoc('slots', slot.id), { status: 'booked', appointmentId: apptRef.id, bookedBy: profile.uid, updatedAt: serverTimestamp() });
  return apptRef.id;
}

export async function bookSlot(profile, slot, details, managerUids) {
  const batch = writeBatch(db);
  const id = bookInto(batch, profile, slot, details);
  const when = fmtDateTime(slot.start);
  for (const u of managerUids) addNotify(batch, profile, u, `New appointment: ${details.attendeeName || profile.name}`, `${when} — ${details.purpose || ''}`, '/meetings?tab=diary');
  if (details.attendeeUid && details.attendeeUid !== profile.uid) {
    addNotify(batch, profile, details.attendeeUid, 'Appointment confirmed', `${when} with the Resident Pastor`, '/meetings?tab=mine');
  }
  addAudit(batch, profile, 'appointment.booked', 'appointment', id, `${when} — ${details.attendeeName || profile.name}`);
  try { await batch.commit(); } catch (e) {
    if (e.code === 'permission-denied') throw new Error('Sorry — that slot was just taken or is no longer available. Please pick another.');
    throw e;
  }
  return id;
}

export async function cancelAppointment(profile, appt, reason, managerUids) {
  const batch = writeBatch(db);
  batch.update(bdoc('appointments', appt.id), { status: 'cancelled', cancelReason: reason || '', cancelledBy: profile.name, updatedAt: serverTimestamp() });
  batch.update(bdoc('slots', appt.slotId), { status: 'open', appointmentId: null, bookedBy: null, updatedAt: serverTimestamp() });
  const when = fmtDateTime(appt.start);
  if (appt.attendeeUid) addNotify(batch, profile, appt.attendeeUid, 'Appointment cancelled', `${when}${reason ? ` — ${reason}` : ''}`, '/meetings?tab=mine');
  for (const u of managerUids) addNotify(batch, profile, u, `Appointment cancelled: ${appt.attendeeName}`, `${when}${reason ? ` — ${reason}` : ''}`, '/meetings?tab=diary');
  addAudit(batch, profile, 'appointment.cancelled', 'appointment', appt.id, `${when} — ${appt.attendeeName}`);
  await batch.commit();
}

export async function rescheduleAppointment(profile, appt, newSlot, managerUids) {
  const batch = writeBatch(db);
  const newId = bookInto(batch, profile, newSlot, {
    attendeeUid: appt.attendeeUid ?? null, attendeeName: appt.attendeeName, phone: appt.phone, purpose: appt.purpose,
    location: appt.location, rescheduledFrom: appt.id,
  });
  batch.update(bdoc('appointments', appt.id), { status: 'rescheduled', rescheduledTo: newId, cancelledBy: profile.name, updatedAt: serverTimestamp() });
  batch.update(bdoc('slots', appt.slotId), { status: 'open', appointmentId: null, bookedBy: null, updatedAt: serverTimestamp() });
  const msg = `${fmtDateTime(appt.start)} → ${fmtDateTime(newSlot.start)}`;
  if (appt.attendeeUid) addNotify(batch, profile, appt.attendeeUid, 'Appointment rescheduled', msg, '/meetings?tab=mine');
  for (const u of managerUids) addNotify(batch, profile, u, `Appointment rescheduled: ${appt.attendeeName}`, msg, '/meetings?tab=diary');
  addAudit(batch, profile, 'appointment.rescheduled', 'appointment', appt.id, msg);
  try { await batch.commit(); } catch (e) {
    if (e.code === 'permission-denied') throw new Error('That new slot was just taken or is no longer available. Please pick another.');
    throw e;
  }
  return newId;
}
