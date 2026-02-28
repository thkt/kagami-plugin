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
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
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
function categorize(name, input) {
  if (name === "Skill")
    return "skill";
  if (name === "Agent" && input.subagent_type)
    return "subagent";
  if (name.startsWith("mcp__"))
    return "mcp";
  return "builtin";
}
function resolveToolName(name, input) {
  if (name === "Skill" && typeof input.skill === "string") {
    return input.skill;
  }
  if (name === "Agent" && typeof input.subagent_type === "string") {
    return input.subagent_type;
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
    for (const tu of toolUses) {
      const category = categorize(tu.name, tu.input);
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
        timestamp
      });
    }
  }
  if (!sessionId || events.length === 0)
    return null;
  let totalCost = 0;
  for (const [model, tokens] of Object.entries(byModel)) {
    tokens.estimatedCostUsd = estimateCost(model, tokens);
    totalCost += tokens.estimatedCostUsd;
  }
  const userId = await getGitUserEmail(cwd);
  return {
    sessionId,
    userId,
    cwd,
    gitBranch,
    ccVersion: "",
    sessionStartedAt: firstTimestamp,
    sessionEndedAt: lastTimestamp,
    events,
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

// src/stop-hook.ts
var execFileAsync2 = promisify2(execFile2);
var API_URL = process.env.KAGAMI_API_URL;
var API_KEY = process.env.KAGAMI_API_KEY;
if (!API_URL)
  process.exit(0);
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}
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
  try {
    await sendPayload(API_URL, API_KEY, payload, 8000);
  } catch {}
}
main();
