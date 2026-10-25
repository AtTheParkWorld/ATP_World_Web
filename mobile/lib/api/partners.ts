/**
 * Partner directory (Admin → Partners → Directory) — the same list the
 * website's "They support the mission" section shows. Public endpoint.
 */
import { api } from './client';

export interface DirectoryPartner {
  id: string;
  name: string;
  logo_url: string | null;
  website_url: string | null;
  is_featured?: boolean | string | null;
}

export function listPartners(): Promise<{ partners: DirectoryPartner[] }> {
  return api.get('/partners/directory');
}
