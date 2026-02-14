import { generateOutline } from "./ai_summarize";

const ALLOWED_ORIGINS = new Set([
	"https://blog.alearn.org.tw",
	"http://localhost:5173",
	"http://localhost:5174",
	"http://localhost:8787",
]);

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

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);

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
				const body = (await request.json()) as { text?: string; transcription?: string };
				const inputText = (body.text ?? body.transcription ?? "").trim();

				if (!inputText) {
					return json({ error: "text is required" }, 400, corsHeaders);
				}

				const result = await generateOutline(inputText, env as any);
				return json({ text: result }, 200, corsHeaders);
			} catch (error) {
				console.error("summarize api error:", error);
				return json({ error: "invalid request or summarize failed" }, 500, corsHeaders);
			}
		}

		return json({ message: "Hello World!" });
	},
} satisfies ExportedHandler<Env>;
