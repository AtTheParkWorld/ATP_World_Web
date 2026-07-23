/**
 * Universal-link alias. The magic-link email points at
 * {FRONTEND_URL}/auth/verify?token&email and the AASA claims /auth/verify —
 * expo-router must therefore have a real route at /auth/verify, otherwise
 * iOS opens the app on the Unmatched Route screen and the single-use
 * token dies there. The actual verify logic lives in the (auth) group's
 * magic-link-callback screen; this file just re-exports it at the URL
 * the email actually uses.
 */
export { default } from '../(auth)/magic-link-callback';
