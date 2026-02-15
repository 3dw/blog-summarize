import { generateOutline } from "./ai_summarize";

const ALLOWED_ORIGINS = new Set([
	"https://blog.alearn.org.tw",
	"http://localhost:5173",
	"http://localhost:5174",
	"http://localhost:8787",
]);

const SUMMARY_CACHE_PREFIX = "summary-cache/v1";
const SUMMARY_MODEL_TAG = "gpt-oss-120b";

type SummarizeRequestBody = { text?: string; transcription?: string; pagePath?: string; sourceId?: string };
type CachedSummaryPayload = { text: string; model: string; createdAt: string };
type WorkerEnv = Env & { SUMMARY_CACHE?: R2Bucket };

function createCorsHeaders(origin: string): HeadersInit {
	return {
		"access-control-allow-origin": origin,
		"access-control-allow-methods": "POST, OPTIONS",
		"access-control-allow-headers": "Content-Type",
		"access-control-max-age": "86400",
		vary: "Origin",
	};
}

function json(data: unknown, status: number = 200, headers: HeadersInit = {}): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			"content-type": "application/json; charset=utf-8",
			...headers,
		},
	});
}

function normalizeInputText(inputText: string): string {
	return inputText.replace(/\r\n/g, "\n").trim();
}

function toHex(buffer: ArrayBuffer): string {
	return Array.from(new Uint8Array(buffer))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

async function buildSummaryCacheKey(inputText: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(inputText));
	return `${SUMMARY_CACHE_PREFIX}/${SUMMARY_MODEL_TAG}/${toHex(digest)}.json`;
}

function normalizeSourceId(sourceId: string): string {
	return sourceId.replace(/[^a-zA-Z0-9/_-]/g, "_").replace(/\/+/g, "/").replace(/^\/|\/$/g, "") || "unknown";
}

async function readSummaryCache(env: WorkerEnv, cacheKey: string): Promise<string | null> {
	if (!env.SUMMARY_CACHE) return null;
	const object = await env.SUMMARY_CACHE.get(cacheKey);
	if (!object) return null;

	try {
		const payload = (await object.json()) as CachedSummaryPayload;
		const text = payload?.text?.trim();
		return text || null;
	} catch (error) {
		console.warn("cache parse failed:", error);
		return null;
	}
}

async function writeSummaryCache(env: WorkerEnv, cacheKey: string, summaryText: string): Promise<void> {
	if (!env.SUMMARY_CACHE) return;
	const payload: CachedSummaryPayload = {
		text: summaryText,
		model: SUMMARY_MODEL_TAG,
		createdAt: new Date().toISOString(),
	};
	await env.SUMMARY_CACHE.put(cacheKey, JSON.stringify(payload), {
		httpMetadata: { contentType: "application/json; charset=utf-8" },
	});
}

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);
		const workerEnv = env as WorkerEnv;

		if (url.pathname === "/api/summarize") {
			const origin = request.headers.get("Origin");
			const isAllowedOrigin = origin !== null && ALLOWED_ORIGINS.has(origin);
			const corsHeaders = isAllowedOrigin && origin ? createCorsHeaders(origin) : {};

			if (request.method === "OPTIONS") {
				if (!isAllowedOrigin) {
					return new Response(null, { status: 403 });
				}
				return new Response(null, {
					status: 204,
					headers: corsHeaders,
				});
			}

			// 若有 Origin 才進行 CORS allowlist 驗證；curl 預設不帶 Origin。
			if (origin !== null && !isAllowedOrigin) {
				return json({ error: "Origin not allowed" }, 403);
			}

			if (request.method !== "POST") {
				return json({ error: "Method Not Allowed" }, 405, corsHeaders);
			}

			try {
				const body = (await request.json()) as SummarizeRequestBody;
				const inputText = normalizeInputText(body.text ?? body.transcription ?? "");
				const sourceIdRaw = (body.pagePath ?? body.sourceId ?? "unknown").trim();

				if (!inputText) {
					return json({ error: "text is required" }, 400, corsHeaders);
				}

				const textHashKey = await buildSummaryCacheKey(inputText);
				const sourceId = normalizeSourceId(sourceIdRaw);
				const cacheKey = textHashKey.replace(
					`${SUMMARY_CACHE_PREFIX}/${SUMMARY_MODEL_TAG}/`,
					`${SUMMARY_CACHE_PREFIX}/${SUMMARY_MODEL_TAG}/${sourceId}/`,
				);
				const cachedSummary = await readSummaryCache(workerEnv, cacheKey);
				if (cachedSummary) {
					return json({ text: cachedSummary, cached: true }, 200, corsHeaders);
				}

				const result = await generateOutline(inputText, workerEnv as any);
				ctx.waitUntil(writeSummaryCache(workerEnv, cacheKey, result));
				return json({ text: result, cached: false }, 200, corsHeaders);
			} catch (error) {
				console.error("summarize api error:", error);
				return json({ error: "invalid request or summarize failed" }, 500, corsHeaders);
			}
		}

		return json({ message: "Hello World!" });
	},
} satisfies ExportedHandler<Env>;
