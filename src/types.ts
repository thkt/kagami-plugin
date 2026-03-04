/** Plugin → API 送信ペイロード */
export interface EventPayload {
  sessionId: string;
  userId: string;
  cwd: string;
  gitBranch: string | null;
  ccVersion: string;
  /** 送信元を識別する（"stop" | "startup-send" | "backfill"） */
  source?: string;
  sessionStartedAt: string;
  sessionEndedAt: string;
  events: ToolEventInput[];
  tokenSummary: TokenSummary;
  messageSummary: MessageSummary;
}

export interface MessageSummary {
  userMessages: number;
  assistantMessages: number;
}

export interface ToolEventInput {
  category: "skill" | "subagent" | "mcp" | "builtin";
  toolName: string;
  toolInput: Record<string, unknown> | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  timestamp: string;
}

export interface TokenSummary {
  byModel: Record<string, ModelTokens>;
  totalEstimatedCostUsd: number;
}

export interface ModelTokens {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  estimatedCostUsd: number;
}

/** JSONL の1行を表す型 */
export interface TranscriptLine {
  type: string;
  sessionId?: string;
  timestamp?: string;
  cwd?: string;
  gitBranch?: string;
  /** subagent セッションの場合に設定される */
  agentId?: string;
  /** スキル展開やメタ情報の注入を示すフラグ */
  isMeta?: boolean;
  message?: {
    role: string;
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
    content?: ContentBlock[];
  };
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: unknown };
