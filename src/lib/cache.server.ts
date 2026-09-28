import { createHash } from "node:crypto";
import { Redis } from "@upstash/redis";

let client: Redis | null | undefined;
let warned = false;

function getClient(): Redis | null {
	if (client !== undefined) return client;
	const url = process.env.UPSTASH_REDIS_REST_URL;
	const token = process.env.UPSTASH_REDIS_REST_TOKEN;
	if (!url || !token) {
		if (!warned) {
			console.warn(
				"UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN are not set — caching is disabled.",
			);
			warned = true;
		}
		client = null;
		return client;
	}
	client = new Redis({ url, token });
	return client;
}

export async function getCached<T>(key: string): Promise<T | null> {
	const redis = getClient();
	if (!redis) return null;
	try {
		const value = await redis.get<T>(key);
		return value ?? null;
	} catch (error) {
		console.error("cache: failed to read key", key, error);
		return null;
	}
}

export async function setCached(
	key: string,
	value: unknown,
	ttlSeconds: number,
): Promise<void> {
	const redis = getClient();
	if (!redis) return;
	try {
		await redis.set(key, value, { ex: ttlSeconds });
	} catch (error) {
		console.error("cache: failed to write key", key, error);
	}
}

export async function deleteCached(key: string): Promise<void> {
	const redis = getClient();
	if (!redis) return;
	try {
		await redis.del(key);
	} catch (error) {
		console.error("cache: failed to delete key", key, error);
	}
}

export async function cacheAside<T>(input: {
	key: string;
	ttlSeconds: number;
	compute: () => Promise<T>;
}): Promise<T> {
	const cached = await getCached<T>(input.key);
	if (cached !== null) return cached;

	const computed = await input.compute();
	// Best-effort: a failed write here must never take down the value we
	// already have, so setCached swallows its own errors.
	await setCached(input.key, computed, input.ttlSeconds);
	return computed;
}

export function buildSearchCacheKey(input: {
	query: string;
	filters: Record<string, unknown>;
	page: number;
	pageSize: number;
	retrievalVersion: string;
	embeddingVersion: string;
	rerankerVersion: string;
}): string {
	const normalizedQuery = input.query.trim().toLowerCase();
	// Sort filter keys so equivalent filter objects (built in any key order)
	// always hash to the same cache key.
	const sortedFilters = Object.keys(input.filters)
		.sort()
		.reduce<Record<string, unknown>>((acc, filterKey) => {
			acc[filterKey] = input.filters[filterKey];
			return acc;
		}, {});

	const payload = JSON.stringify({
		query: normalizedQuery,
		filters: sortedFilters,
		page: input.page,
		pageSize: input.pageSize,
	});
	const hash = createHash("sha256").update(payload).digest("hex");

	return `search:${input.retrievalVersion}:${input.embeddingVersion}:${input.rerankerVersion}:${hash}`;
}
