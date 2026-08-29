/**
 * CMS-backed copy the app needs at runtime. Today: the session booking
 * terms (accident waiver / liability release / media consent) that the
 * website already gates its booking modal on — the app must gate on the
 * SAME text so a booking means the same thing on either device.
 */
import { api } from './client';

const FALLBACK_TERMS =
  'By booking this session you agree that participation is at your own risk. ' +
  "Please arrive on time and follow the coach's safety instructions throughout. " +
  'If you can no longer attend, cancel via your profile so the spot frees up for ' +
  'another member. ATP reserves the right to refuse entry if attendance compromises ' +
  'the safety of the group.';

/**
 * Never throws: if the CMS is unreachable we still show terms (the
 * generic fallback) rather than letting the member book with none.
 */
export async function getSessionTerms(): Promise<string> {
  try {
    const d: any = await api.get('/cms/sessions');
    const text = d?.content?.booking_terms?.terms_text;
    return (typeof text === 'string' && text.trim()) ? text : FALLBACK_TERMS;
  } catch {
    return FALLBACK_TERMS;
  }
}
