import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { basename } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { estimateCost } from "./cost";
import type {
  ContentBlock,
  EventPayload,
  ModelTokens,
  ToolEventInput,
  TranscriptLine,
} from "./types";

const execFileAsync = promisify(execFile);

/**
 * Claude Code ビルトインツール一覧
 *
 * 収集対象だが toolInput を null にしてペイロードサイズを抑える。
 * Skill / Agent / mcp__ / Bash は categorize() 内で先に分岐するためここには含めない。
 * SendMessage, TeamCreate 等のチーム系ツールは利用頻度が低いため対象外。
 */
const BUILTIN_TOOLS = new Set([
  "Read",
  "Write",
  "Edit",
  "MultiEdit",
  "Grep",
  "Glob",
  "LS",
  "WebSearch",
  "WebFetch",
  "LSP",
  "ToolSearch",
  "TodoRead",
  "TodoWrite",
  "TaskCreate",
  "TaskUpdate",
  "TaskGet",
  "TaskList",
  "AskUserQuestion",
  "EnterPlanMode",
  "ExitPlanMode",
  "EnterWorktree",
]);

const MAX_EVENTS = 500;

/**
 * Deterministic UUID from namespace + name using SHA-256.
 * subagent の sessionId 生成に使用。結果は UUID v4 形式。
 */
export function deterministicUuid(namespace: string, name: string): string {
  const hash = createHash("sha256").update(`${namespace}:${name}`).digest();
  hash[6] = (hash[6] & 0x0f) | 0x40; // version 4
  hash[8] = (hash[8] & 0x3f) | 0x80; // variant 10xx
  const hex = hash.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** tool_use のカテゴリを分類する (BR-01) */
export function categorize(
  name: string,
  input: Record<string, unknown>,
): ToolEventInput["category"] | null {
  if (name === "Skill") return "skill";
  if (name === "Agent" && input.subagent_type) return "subagent";
  if (name.startsWith("mcp__")) return "mcp";
  if (name === "Bash") return "cli";
  if (BUILTIN_TOOLS.has(name)) return "builtin";
  return null;
}

const RE_BASH_CMD = /(?:\w+=\S+\s+)*(\S+)/;
/** コマンド名として妥当: 英字・数字・ハイフン・アンダースコア・ドットで始まる */
const RE_VALID_CMD = /^[a-zA-Z0-9._]/;

export function extractBashToolName(command: string): string {
  const m = command.match(RE_BASH_CMD);
  if (!m) return "Bash";
  const name = basename(m[1]);
  if (!name || name === "." || !RE_VALID_CMD.test(name)) return "Bash";
  return name;
}

function resolveToolName(name: string, input: Record<string, unknown>): string {
  if (name === "Skill" && typeof input.skill === "string") {
    return input.skill;
  }
  if (name === "Agent" && typeof input.subagent_type === "string") {
    return input.subagent_type;
  }
  if (name === "Bash" && typeof input.command === "string") {
    return extractBashToolName(input.command);
  }
  return name;
}

/**
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

function extractToolUses(
  content: ContentBlock[],
): Array<{ name: string; input: Record<string, unknown> }> {
  return content
    .filter(
      (block): block is Extract<ContentBlock, { type: "tool_use" }> => block.type === "tool_use",
    )
    .map((block) => ({ name: block.name, input: block.input }));
}

export async function parseTranscript(filePath: string): Promise<EventPayload | null> {
  const events: ToolEventInput[] = [];
  const byModel: Record<string, ModelTokens> = {};
  let sessionId = "";
  let agentId = "";
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
      continue;
    }

    if (line.sessionId && !sessionId) sessionId = line.sessionId;
    if (line.agentId && !agentId) agentId = line.agentId;
    if (line.cwd && !cwd) cwd = line.cwd;
    if (line.gitBranch !== undefined && gitBranch === null) gitBranch = line.gitBranch ?? null;
    if (line.timestamp) {
      if (!firstTimestamp) firstTimestamp = line.timestamp;
      lastTimestamp = line.timestamp;
    }

    // メッセージ数カウント（isMeta はシステム注入なので除外）
    if (line.type === "user" && !line.isMeta) userMessages++;
    if (line.type === "assistant") assistantMessages++;

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

    if (line.type !== "assistant" || !line.message) continue;
    const msg = line.message;

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

    if (!msg.content) continue;
    const toolUses = extractToolUses(msg.content);
    const timestamp = line.timestamp ?? lastTimestamp;

    // token 按分の分母: categorize に通る tool_use 数を先にカウント
    let divisor = 0;
    for (const tu of toolUses) {
      if (categorize(tu.name, tu.input) !== null) divisor++;
    }
    if (divisor === 0) divisor = 1;

    // NOTE: msg.usage はメッセージ単位。複数 tool_use を含む場合は按分する。
    for (const tu of toolUses) {
      const category = categorize(tu.name, tu.input);
      if (!category) continue;

      events.push({
        category,
        toolName: resolveToolName(tu.name, tu.input),
        toolInput: category === "builtin" || category === "cli" ? null : tu.input,
        model,
        inputTokens: Math.round((msg.usage?.input_tokens ?? 0) / divisor),
        outputTokens: Math.round((msg.usage?.output_tokens ?? 0) / divisor),
        cacheCreationTokens: Math.round((msg.usage?.cache_creation_input_tokens ?? 0) / divisor),
        cacheReadTokens: Math.round((msg.usage?.cache_read_input_tokens ?? 0) / divisor),
        timestamp,
      });
    }
  }

  // model が空のイベントを後続の assistant レスポンスから逆引きで埋める
  const fallbackModel = Object.keys(byModel)[0] ?? "";
  if (fallbackModel) {
    for (const event of events) {
      if (!event.model) event.model = fallbackModel;
    }
  }

  // model が空のまま残ったイベントは除外（サーバー側 min(1) バリデーション対策）
  const validEvents = events.filter((e) => e.model);

  // builtin を後回しにして上限内に収める
  const truncated = truncateEvents(validEvents, MAX_EVENTS);

  if (!sessionId || truncated.length === 0) return null;

  // subagent は親と sessionId が同じなので agentId から deterministic UUID を生成
  const effectiveSessionId = agentId ? deterministicUuid(sessionId, agentId) : sessionId;

  // コスト算出 (BR-02)
  let totalCost = 0;
  for (const [model, tokens] of Object.entries(byModel)) {
    tokens.estimatedCostUsd = estimateCost(model, tokens);
    totalCost += tokens.estimatedCostUsd;
  }

  const userId = await getGitUserEmail(cwd);

  return {
    sessionId: effectiveSessionId,
    userId,
    cwd,
    gitBranch,
    ccVersion: "", // Stop hook から注入
    sessionStartedAt: firstTimestamp,
    sessionEndedAt: lastTimestamp,
    events: truncated,
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

/**
 * イベント数が上限を超えた場合、builtin/cli を切り捨てて skill/subagent/mcp を優先する。
 * 時系列順は維持する。返り値は必ず max 以下。
 */
export function truncateEvents(events: ToolEventInput[], max: number): ToolEventInput[] {
  if (events.length <= max) return events;

  const lowPriority = new Set<ToolEventInput["category"]>(["builtin", "cli"]);
  // 低優先度の index を収集し、末尾から削る（時系列順維持）
  const lowPriorityIndices: number[] = [];
  for (let i = 0; i < events.length; i++) {
    if (lowPriority.has(events[i].category)) lowPriorityIndices.push(i);
  }

  const lowPriorityKeep = Math.max(0, max - (events.length - lowPriorityIndices.length));
  // lowPriorityIndices は昇順なので、keep 以降が drop 対象
  let dropPtr = lowPriorityKeep;
  const result: ToolEventInput[] = [];
  for (let i = 0; i < events.length && result.length < max; i++) {
    if (dropPtr < lowPriorityIndices.length && lowPriorityIndices[dropPtr] === i) {
      dropPtr++;
      continue;
    }
    result.push(events[i]);
  }
  return result;
}
