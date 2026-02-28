/**
 * kagami Stop hook
 *
 * セッション終了時に JSONL を解析し、API に POST 送信する。
 * 非同期でセッション終了をブロックしない (NFR-005)。
 */
import { parseTranscript } from "./parser";

interface StopHookInput {
	session_id: string;
	transcript_path: string;
	cwd: string;
	stop_hook_active?: boolean;
}

const API_URL = Bun.env.KAGAMI_API_URL;
const API_KEY = Bun.env.KAGAMI_API_KEY;

if (!API_URL) process.exit(0); // 未設定なら何もしない

async function main() {
	// stdin から hook input を読む
	const raw = await new Response(Bun.stdin.stream()).text();
	let input: StopHookInput;
	try {
		input = JSON.parse(raw);
	} catch {
		process.exit(0); // JSON パース失敗は無視
	}

	// transcript_path がなければ何もしない
	if (!input.transcript_path) {
		process.exit(0);
	}

	// JSONL を解析
	const payload = await parseTranscript(input.transcript_path);
	if (!payload) {
		process.exit(0); // tool_use なしセッションはスキップ
	}

	// ccVersion を注入
	try {
		const proc = Bun.spawn(["claude", "--version"], {
			stdout: "pipe",
			stderr: "ignore",
		});
		const version = (await new Response(proc.stdout).text()).trim();
		payload.ccVersion = version;
	} catch {
		payload.ccVersion = "unknown";
	}

	// API に POST (fire-and-forget, タイムアウト 8s)
	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 8000);

		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};
		if (API_KEY) headers.Authorization = `Bearer ${API_KEY}`;

		await fetch(`${API_URL}/api/events`, {
			method: "POST",
			headers,
			body: JSON.stringify(payload),
			signal: controller.signal,
		});

		clearTimeout(timeout);
	} catch {
		// ネットワークエラーは無視 (NFR-005: ブロックしない)
	}
}

main();
