// Daily salts prevent linking anonymous hashes across days.
import type { Env } from '../types';
import { clientIp } from '../utils';

const DAU_PREFIX = 'dau:';
// Retain keys for the longest admin query window.
const DAU_TTL_SEC = 8 * 24 * 3600;
export const DAU_MAX_QUERY_DAYS = 8;

function utcDay(date: Date = new Date()): string {
	return date.toISOString().slice(0, 10);
}

async function dailyHash(salt: string, day: string, ip: string): Promise<string> {
	const bytes = new TextEncoder().encode(`${salt}:${day}:${ip}`);
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return [...new Uint8Array(digest).slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function recordActiveUser(req: Request, env: Env, ctx?: ExecutionContext): void {
	const salt = env.STATS_SALT;
	if (!salt || !ctx) return;
	const ip = clientIp(req);
	if (ip === 'unknown') return;
	ctx.waitUntil(
		(async () => {
			try {
				const day = utcDay();
				const key = `${DAU_PREFIX}${day}:${await dailyHash(salt, day, ip)}`;
				if ((await env.ITEM_META.get(key)) === null) {
					await env.ITEM_META.put(key, '1', { expirationTtl: DAU_TTL_SEC });
				}
			} catch (err) {
				// Keep analytics failures off the request path, but visible in tail.
				console.log('[DAU] error', String(err));
			}
		})(),
	);
}

export async function countActiveUsers(env: Env, days: number): Promise<Array<{ date: string; users: number }>> {
	const out: Array<{ date: string; users: number }> = [];
	const now = Date.now();
	for (let i = 0; i < days; i++) {
		const day = utcDay(new Date(now - i * 24 * 3600 * 1000));
		let cursor: string | undefined;
		let users = 0;
		do {
			const page = await env.ITEM_META.list({ prefix: `${DAU_PREFIX}${day}:`, ...(cursor ? { cursor } : {}) });
			users += page.keys.length;
			cursor = page.list_complete ? undefined : page.cursor;
		} while (cursor);
		out.push({ date: day, users });
	}
	return out;
}
