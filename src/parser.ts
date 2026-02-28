import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { estimateCost } from "./cost";

const execFileAsync = promisify(execFile);
import type {
  ContentBlock,
  EventPayload,
  ModelTokens,
  ToolEventInput,
  TranscriptLine,
} from "./types";

/**
 * tool_use のカテゴリを分類する (BR-01)
 *
 * - name === "Skill" → skill
 * - name === "Agent" && input.subagent_type → subagent
 * - name.startsWith("mcp__") → mcp
 * - それ以外 → null（収集対象外）
 */
export function categorize(
  name: string,
  input: Record<string, unknown>,
): ToolEventInput["category"] | null {
  if (name === "Skill") return "skill";
  if (name === "Agent" && input.subagent_type) return "subagent";
  if (name.startsWith("mcp__")) return "mcp";
  return null;
}

/**
 * Skill/Agent の場合、表示用ツール名を抽出する
 *
 * - Skill      → input.skill (e.g. "commit", "audit")
 * - Agent → input.subagent_type (e.g. "Explore", "general-purpose")
 * - MCP        → そのまま (e.g. "mcp__scout__search")
 * - その他     → そのまま (収集対象外だが念のため)
 */
function resolveToolName(name: string, input: Record<string, unknown>): string {
  if (name === "Skill" && typeof input.skill === "string") {
    return input.skill;
  }
  if (name === "Agent" && typeof input.subagent_type === "string") {
    return input.subagent_type;
  }
  return name;
}

/**
 * isMeta: true の user メッセージからスラッシュコマンド名を抽出する
 *
 * スキル展開は `# /<name> - <description>` 形式のヘッダで始まる。
 * ネスト呼び出し（Skill tool 経由）は `# <Name>:` 形式なのでマッチしない。
 */
export function extractSkillName(content: ContentBlock[]): string | null {
  for (const block of content) {
    if (block.type !== "text") continue;
    const match = block.text.match(/^#\s*\/(\S+)/);
    if (match) return match[1];
  }
  return null;
}

/** assistant メッセージから tool_use ブロックを抽出する */
function extractToolUses(
  content: ContentBlock[],
): Array<{ name: string; input: Record<string, unknown> }> {
  return content
    .filter(
      (block): block is Extract<ContentBlock, { type: "tool_use" }> => block.type === "tool_use",
    )
    .map((block) => ({ name: block.name, input: block.input }));
}

/**
 * JSONL ファイルをストリーミング解析し、EventPayload を構築する (FR-001)
 */
export async function parseTranscript(filePath: string): Promise<EventPayload | null> {
  const events: ToolEventInput[] = [];
  const byModel: Record<string, ModelTokens> = {};
  let sessionId = "";
  let cwd = "";
  let gitBranch: string | null = null;
  let firstTimestamp = "";
  let lastTimestamp = "";
  let currentModel = "";
  let userMessages = 0;
  let assistantMessages = 0;

  const rl = createInterface({
    input: createReadStream(filePath),
    crlfDelay: Number.POSITIVE_INFINITY,
  });

  for await (const rawLine of rl) {
    let line: TranscriptLine;
    try {
      line = JSON.parse(rawLine);
    } catch {
      continue; // 不正行はスキップ
    }

    // セッション情報を取得
    if (line.sessionId && !sessionId) sessionId = line.sessionId;
    if (line.cwd && !cwd) cwd = line.cwd;
    if (line.gitBranch !== undefined && gitBranch === null) gitBranch = line.gitBranch ?? null;
    if (line.timestamp) {
      if (!firstTimestamp) firstTimestamp = line.timestamp;
      lastTimestamp = line.timestamp;
    }

    // メッセージ数カウント（isMeta はシステム注入なので除外）
    if (line.type === "user" && !line.isMeta) userMessages++;
    if (line.type === "assistant") assistantMessages++;

    // isMeta: true の user メッセージからスラッシュコマンド呼び出しを検出
    if (
      line.type === "user" &&
      line.isMeta === true &&
      line.message?.content &&
      Array.isArray(line.message.content)
    ) {
      const skillName = extractSkillName(line.message.content);
      if (skillName) {
        events.push({
          category: "skill",
          toolName: skillName,
          toolInput: null,
          model: currentModel,
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          timestamp: line.timestamp ?? lastTimestamp,
        });
      }
    }

    // assistant メッセージだけ処理
    if (line.type !== "assistant" || !line.message) continue;
    const msg = line.message;

    // モデルとトークン集計
    const model = msg.model ?? currentModel;
    if (model) currentModel = model;

    if (msg.usage) {
      const u = msg.usage;
      if (!byModel[model]) {
        byModel[model] = {
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          estimatedCostUsd: 0,
        };
      }
      const m = byModel[model];
      m.inputTokens += u.input_tokens ?? 0;
      m.outputTokens += u.output_tokens ?? 0;
      m.cacheCreationTokens += u.cache_creation_input_tokens ?? 0;
      m.cacheReadTokens += u.cache_read_input_tokens ?? 0;
    }

    // tool_use 抽出
    if (!msg.content) continue;
    const toolUses = extractToolUses(msg.content);
    const timestamp = line.timestamp ?? lastTimestamp;

    for (const tu of toolUses) {
      const category = categorize(tu.name, tu.input);
      if (!category) continue;
      const toolName = resolveToolName(tu.name, tu.input);

      events.push({
        category,
        toolName,
        toolInput: tu.input,
        model,
        inputTokens: msg.usage?.input_tokens ?? 0,
        outputTokens: msg.usage?.output_tokens ?? 0,
        cacheCreationTokens: msg.usage?.cache_creation_input_tokens ?? 0,
        cacheReadTokens: msg.usage?.cache_read_input_tokens ?? 0,
        timestamp,
      });
    }
  }

  if (!sessionId || events.length === 0) return null;

  // コスト算出 (BR-02)
  let totalCost = 0;
  for (const [model, tokens] of Object.entries(byModel)) {
    tokens.estimatedCostUsd = estimateCost(model, tokens);
    totalCost += tokens.estimatedCostUsd;
  }

  // userId: git user.email → fallback to system username
  const userId = await getGitUserEmail(cwd);

  return {
    sessionId,
    userId,
    cwd,
    gitBranch,
    ccVersion: "", // Stop hook から注入
    sessionStartedAt: firstTimestamp,
    sessionEndedAt: lastTimestamp,
    events,
    tokenSummary: {
      byModel,
      totalEstimatedCostUsd: totalCost,
    },
    messageSummary: {
      userMessages,
      assistantMessages,
    },
  };
}

async function getGitUserEmail(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["config", "user.email"], {
      cwd,
    });
    return stdout.trim() || getUserFallback();
  } catch {
    return getUserFallback();
  }
}

function getUserFallback(): string {
  return process.env.USER ?? process.env.USERNAME ?? "unknown";
}
