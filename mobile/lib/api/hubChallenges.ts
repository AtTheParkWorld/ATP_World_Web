/**
 * 30x30 Fitness Hub + 30x30 Challenges (founder 2026-10-19) — the app
 * version of atthepark.world/30x30-hub. Same API as the website:
 *   - hub classes  = sessions with session_category '30x30_hub'
 *   - challenge slots = sessions with session_category '30x30_challenge'
 *     (hub_challenge_id + hub_challenge_stage 'qualifier' | 'final')
 *   - GET  /hub-challenges                  challenges (+ my entry / team)
 *   - GET  /hub-challenges/:id/leaderboard  ?stage=qualifier|final
 *   - POST /hub-challenges/:id/teams        { name, session_id }  captain
 *   - GET  /hub-challenges/teams/:code      invite preview
 *   - POST /hub-challenges/teams/:code/join
 *   - POST /hub-challenges/:id/donation     { choice }
 * Registration itself is a normal booking (createBooking) — the server
 * enforces one slot per day, team-first and no direct final booking.
 */
import { api, WEB_BASE } from './client';

export interface HubTeam {
  id: string;
  name: string;
  members: number;
  is_captain: boolean;
  invite_code: string;
  invite_url: string;
}

export interface HubChallenge {
  id: string;
  name: string;
  description: string | null;
  kind: 'individual' | 'team';
  team_min: number | null;
  team_max: number | null;
  team_size_label: string | null;
  result_type: 'time' | 'score';
  result_unit: string | null;
  split_gender: boolean;
  finals_cut_enabled: boolean;
  finals_cut: number | null;
  charity_enabled: boolean;
  charity_name: string | null;
  charity_description: string | null;
  charity_url: string | null;
  qualifier_start: string | null;
  qualifier_end: string | null;
  final_date: string | null;
  entries_count?: number;
  teams_count?: number;
  my_entry?: { donation_choice: 'yes' | 'no' | null; team: HubTeam | null } | null;
}

export interface BoardRow { rank: number; name: string; value: number; qualified: boolean | null }
export interface Board { key: string; label: string; rows: BoardRow[] }
export interface Leaderboard { stage: 'qualifier' | 'final'; boards: Board[]; finals_cut: number | null }

export interface TeamInvite {
  name: string;
  invite_code: string;
  challenge_id: string;
  challenge_name: string;
  captain: string;
  members: number;
  team_max: number;
  team_min: number;
  full: boolean;
  slot_session_id: string | null;
  slot_at: string | null;
  charity_enabled: boolean;
  charity_name: string | null;
  charity_url: string | null;
}

export function listHubChallenges(): Promise<{ challenges: HubChallenge[] }> {
  return api.get('/hub-challenges');
}
export function getHubLeaderboard(id: string, stage: 'qualifier' | 'final'): Promise<Leaderboard> {
  return api.get(`/hub-challenges/${encodeURIComponent(id)}/leaderboard?stage=${stage}`);
}
export function createHubTeam(id: string, name: string, sessionId: string): Promise<{ team: HubTeam & { slot_session_id: string | null } }> {
  return api.post(`/hub-challenges/${encodeURIComponent(id)}/teams`, { name, session_id: sessionId });
}
export function getHubTeam(code: string): Promise<{ team: TeamInvite; mine: { in_this_team: boolean; in_other_team: boolean } | null }> {
  return api.get(`/hub-challenges/teams/${encodeURIComponent(code.trim())}`);
}
export function joinHubTeam(code: string): Promise<{ ok: boolean; team: { name: string; slot_session_id: string | null } }> {
  return api.post(`/hub-challenges/teams/${encodeURIComponent(code.trim())}/join`);
}
export function setHubDonation(id: string, choice: 'yes' | 'no'): Promise<{ ok: boolean }> {
  return api.post(`/hub-challenges/${encodeURIComponent(id)}/donation`, { choice });
}

export const HUB_URL = `${WEB_BASE}/30x30-hub`;
export const inviteUrl = (code: string) => `${HUB_URL}?team=${encodeURIComponent(code)}`;

// ── shared formatting (Dubai time, UTC+4, no DST) ───────────────
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const HUB0 = Date.UTC(2026, 9, 30);            // day 1 = Sat 31 Oct 2026
export const HUB_WEEKS: Array<[number, number]> = [[1, 7], [8, 14], [15, 21], [22, 28], [29, 30]];
export const HUB_END = Date.parse('2026-11-30T00:00:00+04:00');
const dubai = (iso: string) => new Date(Date.parse(iso) + 4 * 3600_000);
export function hubDay(iso: string): number {
  const d = dubai(iso);
  return Math.round((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - HUB0) / 86_400_000);
}
export function hubDayLabel(day: number): string {
  const d = new Date(HUB0 + day * 86_400_000);
  return `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
}
export function hubTime(iso: string): string {
  const d = dubai(iso), h = d.getUTCHours(), m = d.getUTCMinutes();
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
export function hubWhen(iso: string): string { return `${hubDayLabel(hubDay(iso))} · ${hubTime(iso)}`; }
export function ymdLabel(ymd: string | null): string {
  if (!ymd) return '';
  const d = new Date(String(ymd).slice(0, 10) + 'T12:00:00Z');
  return `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
}
export function weekOf(day: number): number {
  for (let w = 0; w < HUB_WEEKS.length; w++) { const r = HUB_WEEKS[w]!; if (day >= r[0] && day <= r[1]) return w; }
  return 0;
}
export function kindLabel(c: HubChallenge): string {
  return c.kind === 'team' ? `Team · ${c.team_min === c.team_max ? c.team_max : `${c.team_min}–${c.team_max}`} members` : 'Individual';
}
export function formatResult(v: number, c: Pick<HubChallenge, 'result_type' | 'result_unit'>): string {
  if (c.result_type === 'score') return `${+v}${c.result_unit ? ` ${c.result_unit}` : ''}`;
  const m = Math.floor(v / 60), r = Math.round((v - m * 60) * 10) / 10;
  const rs = r % 1 ? r.toFixed(1) : String(r);
  return m ? `${m}:${r < 10 ? '0' : ''}${rs}` : `${rs}s`;
}
