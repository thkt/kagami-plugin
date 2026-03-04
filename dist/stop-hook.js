import { createRequire } from "node:module";
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// src/stop-hook.ts
import { execFile as execFile2 } from "node:child_process";
import { promisify as promisify2 } from "node:util";

// src/api.ts
function sendPayload(apiUrl, apiKey, payload, timeoutMs) {
  const headers = {
    "Content-Type": "application/json"
  };
  if (apiKey)
    headers.Authorization = `Bearer ${apiKey}`;
  return fetch(`${apiUrl}/api/events`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined
  });
}

// src/parser.ts
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { basename } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";

// src/cost.ts
var PRICING = {
  "claude-opus-4-6": { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  "claude-haiku-4-5": { input: 0.8, output: 4, cacheWrite: 1, cacheRead: 0.08 }
};
var DEFAULT_PRICING = { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 };
function normalizeModel(model) {
  return model.replace(/-\d{8}$/, "");
}
function estimateCost(model, tokens) {
  const normalized = normalizeModel(model);
  const pricing = PRICING[normalized] ?? DEFAULT_PRICING;
  const perMillion = 1e6;
  return tokens.inputTokens * pricing.input / perMillion + tokens.outputTokens * pricing.output / perMillion + tokens.cacheCreationTokens * pricing.cacheWrite / perMillion + tokens.cacheReadTokens * pricing.cacheRead / perMillion;
}

// src/parser.ts
var execFileAsync = promisify(execFile);
var BUILTIN_TOOLS = new Set([
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
  "EnterWorktree"
]);
var MAX_EVENTS = 500;
function deterministicUuid(namespace, name) {
  const hash = createHash("sha256").update(`${namespace}:${name}`).digest();
  hash[6] = hash[6] & 15 | 64;
  hash[8] = hash[8] & 63 | 128;
  const hex = hash.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
function categorize(name, input) {
  if (name === "Skill")
    return "skill";
  if (name === "Agent" && input.subagent_type)
    return "subagent";
  if (name.startsWith("mcp__"))
    return "mcp";
  if (name === "Bash")
    return "cli";
  if (BUILTIN_TOOLS.has(name))
    return "builtin";
  return null;
}
var RE_BASH_CMD = /(?:\w+=\S+\s+)*(\S+)/;
var RE_VALID_CMD = /^[a-zA-Z0-9._]/;
function extractBashToolName(command) {
  const m = command.match(RE_BASH_CMD);
  if (!m)
    return "Bash";
  const name = basename(m[1]);
  if (!name || name === "." || !RE_VALID_CMD.test(name))
    return "Bash";
  return name;
}
function resolveToolName(name, input) {
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
function extractSkillName(content) {
  for (const block of content) {
    if (block.type !== "text")
      continue;
    const match = block.text.match(/^#\s*\/(\S+)/);
    if (match)
      return match[1];
  }
  return null;
}
function extractToolUses(content) {
  return content.filter((block) => block.type === "tool_use").map((block) => ({ name: block.name, input: block.input }));
}
async function parseTranscript(filePath) {
  const events = [];
  const byModel = {};
  let sessionId = "";
  let agentId = "";
  let cwd = "";
  let gitBranch = null;
  let firstTimestamp = "";
  let lastTimestamp = "";
  let currentModel = "";
  let userMessages = 0;
  let assistantMessages = 0;
  const rl = createInterface({
    input: createReadStream(filePath),
    crlfDelay: Number.POSITIVE_INFINITY
  });
  for await (const rawLine of rl) {
    let line;
    try {
      line = JSON.parse(rawLine);
    } catch {
      continue;
    }
    if (line.sessionId && !sessionId)
      sessionId = line.sessionId;
    if (line.agentId && !agentId)
      agentId = line.agentId;
    if (line.cwd && !cwd)
      cwd = line.cwd;
    if (line.gitBranch !== undefined && gitBranch === null)
      gitBranch = line.gitBranch ?? null;
    if (line.timestamp) {
      if (!firstTimestamp)
        firstTimestamp = line.timestamp;
      lastTimestamp = line.timestamp;
    }
    if (line.type === "user" && !line.isMeta)
      userMessages++;
    if (line.type === "assistant")
      assistantMessages++;
    if (line.type === "user" && line.isMeta === true && line.message?.content && Array.isArray(line.message.content)) {
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
          timestamp: line.timestamp ?? lastTimestamp
        });
      }
    }
    if (line.type !== "assistant" || !line.message)
      continue;
    const msg = line.message;
    const model = msg.model ?? currentModel;
    if (model)
      currentModel = model;
    if (msg.usage) {
      const u = msg.usage;
      if (!byModel[model]) {
        byModel[model] = {
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          estimatedCostUsd: 0
        };
      }
      const m = byModel[model];
      m.inputTokens += u.input_tokens ?? 0;
      m.outputTokens += u.output_tokens ?? 0;
      m.cacheCreationTokens += u.cache_creation_input_tokens ?? 0;
      m.cacheReadTokens += u.cache_read_input_tokens ?? 0;
    }
    if (!msg.content)
      continue;
    const toolUses = extractToolUses(msg.content);
    const timestamp = line.timestamp ?? lastTimestamp;
    let divisor = 0;
    for (const tu of toolUses) {
      if (categorize(tu.name, tu.input) !== null)
        divisor++;
    }
    if (divisor === 0)
      divisor = 1;
    for (const tu of toolUses) {
      const category = categorize(tu.name, tu.input);
      if (!category)
        continue;
      events.push({
        category,
        toolName: resolveToolName(tu.name, tu.input),
        toolInput: category === "builtin" || category === "cli" ? null : tu.input,
        model,
        inputTokens: Math.round((msg.usage?.input_tokens ?? 0) / divisor),
        outputTokens: Math.round((msg.usage?.output_tokens ?? 0) / divisor),
        cacheCreationTokens: Math.round((msg.usage?.cache_creation_input_tokens ?? 0) / divisor),
        cacheReadTokens: Math.round((msg.usage?.cache_read_input_tokens ?? 0) / divisor),
        timestamp
      });
    }
  }
  const fallbackModel = Object.keys(byModel)[0] ?? "";
  if (fallbackModel) {
    for (const event of events) {
      if (!event.model)
        event.model = fallbackModel;
    }
  }
  const validEvents = events.filter((e) => e.model);
  const truncated = truncateEvents(validEvents, MAX_EVENTS);
  if (!sessionId || truncated.length === 0)
    return null;
  const effectiveSessionId = agentId ? deterministicUuid(sessionId, agentId) : sessionId;
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
    ccVersion: "",
    sessionStartedAt: firstTimestamp,
    sessionEndedAt: lastTimestamp,
    events: truncated,
    tokenSummary: {
      byModel,
      totalEstimatedCostUsd: totalCost
    },
    messageSummary: {
      userMessages,
      assistantMessages
    }
  };
}
async function getGitUserEmail(cwd) {
  try {
    const { stdout } = await execFileAsync("git", ["config", "user.email"], {
      cwd
    });
    return stdout.trim() || getUserFallback();
  } catch {
    return getUserFallback();
  }
}
function getUserFallback() {
  return process.env.USER ?? process.env.USERNAME ?? "unknown";
}
function truncateEvents(events, max) {
  if (events.length <= max)
    return events;
  const lowPriority = new Set(["builtin", "cli"]);
  const lowPriorityIndices = [];
  for (let i = 0;i < events.length; i++) {
    if (lowPriority.has(events[i].category))
      lowPriorityIndices.push(i);
  }
  const lowPriorityKeep = Math.max(0, max - (events.length - lowPriorityIndices.length));
  let dropPtr = lowPriorityKeep;
  const result = [];
  for (let i = 0;i < events.length && result.length < max; i++) {
    if (dropPtr < lowPriorityIndices.length && lowPriorityIndices[dropPtr] === i) {
      dropPtr++;
      continue;
    }
    result.push(events[i]);
  }
  return result;
}

// src/stdin.ts
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

// src/stop-hook.ts
var execFileAsync2 = promisify2(execFile2);
var API_URL = process.env.KAGAMI_API_URL ?? "";
var API_KEY = process.env.KAGAMI_API_KEY;
if (!API_URL)
  process.exit(0);
async function main() {
  const raw = await readStdin();
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    process.exit(0);
  }
  if (!input.transcript_path) {
    process.exit(0);
  }
  const payload = await parseTranscript(input.transcript_path);
  if (!payload) {
    process.exit(0);
  }
  try {
    const { stdout } = await execFileAsync2("claude", ["--version"]);
    payload.ccVersion = stdout.trim();
  } catch {
    payload.ccVersion = "unknown";
  }
  payload.source = "stop";
  try {
    await sendPayload(API_URL, API_KEY, payload, 8000);
  } catch {}
}
main();
