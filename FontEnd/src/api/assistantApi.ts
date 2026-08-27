/**
 * Virtual-assistant API — talks to AssistantController (Slices C & D).
 *
 * Endpoint inventory:
 *   POST /api/assistant/chat                     → send a message, get a reply (+ proposals)
 *   GET  /api/assistant/conversations            → the customer's threads (newest first)
 *   GET  /api/assistant/conversations/{id}       → one thread's visible turns
 *
 * A reply's `proposals` are the SAME shape as Slice A's budget proposals (they come
 * from the same validated engine), so they render with the same ProposalCard — and the
 * frontend golden rule holds: no number here is recomputed client-side.
 */

import type { Proposal } from './suggestionsApi';

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5258'
).replace(/\/+$/, '');

// ── Error class ────────────────────────────────────────────────────────

export class AssistantApiError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'AssistantApiError';
    this.status = status;
  }

  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }

  /** True when the assistant is soft-down (disabled / unreachable / provider-throttled). */
  get isUnavailable(): boolean {
    return this.status === 503;
  }
}

// ── Types ──────────────────────────────────────────────────────────────

/** Matches AssistantChatRequest. Omit conversationId to start a new thread. */
export interface ChatRequest {
  conversationId?: string | null;
  message: string;
}

/** Matches AssistantChatResponse. `proposals` is populated when the model used the budget tool. */
export interface ChatResponse {
  conversationId: string;
  reply: string;
  proposals: Proposal[] | null;
}

/** Matches ConversationSummaryDto. */
export interface ConversationSummary {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

/** Matches ConversationMessageDto (role: "User" | "Model"). */
export interface ConversationMessage {
  ordinal: number;
  role: string;
  text: string;
}

/** Matches ConversationDetailDto. */
export interface ConversationDetail {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  messages: ConversationMessage[];
}

// ── Internal helpers (copied from bookingApi.ts's shape) ─────────────────

async function readErrorMessage(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as any;
    if (typeof body.message === 'string') return body.message;
    if (body.errors && typeof body.errors === 'object') {
      const firstKey = Object.keys(body.errors)[0];
      if (firstKey && Array.isArray(body.errors[firstKey]) && body.errors[firstKey].length > 0) {
        return body.errors[firstKey][0];
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function request<T>(
  path: string,
  method: string,
  token: string,
  body?: unknown,
): Promise<T> {
  let res: Response;
  try {
    const options: RequestInit = {
      method,
      headers: { Authorization: `Bearer ${token}` },
    };
    if (body !== undefined) {
      options.headers = { ...options.headers, 'Content-Type': 'application/json' };
      options.body = JSON.stringify(body);
    }
    res = await fetch(`${API_BASE_URL}${path}`, options);
  } catch {
    throw new AssistantApiError(
      'Unable to reach the server. Make sure the backend is running, then try again.',
    );
  }

  if (res.status === 401 || res.status === 403) {
    throw new AssistantApiError(
      'Your session has expired or you lack permission. Please sign in again.',
      res.status,
    );
  }

  if (!res.ok) {
    const message = await readErrorMessage(res);
    throw new AssistantApiError(
      message ?? `The server responded with an error (HTTP ${res.status}).`,
      res.status,
    );
  }

  if (res.status === 204) return {} as T;
  return (await res.json()) as T;
}

// ── Public API ─────────────────────────────────────────────────────────

/** Send one chat turn. Omit conversationId to start a new thread; pass it to continue. */
export function sendChat(token: string, req: ChatRequest): Promise<ChatResponse> {
  return request<ChatResponse>('/api/assistant/chat', 'POST', token, req);
}

/** List the customer's conversations, newest activity first. */
export function listConversations(token: string): Promise<ConversationSummary[]> {
  return request<ConversationSummary[]>('/api/assistant/conversations', 'GET', token);
}

/** Read one conversation's visible turns (User/Model text only). */
export function getConversation(token: string, id: string): Promise<ConversationDetail> {
  return request<ConversationDetail>(`/api/assistant/conversations/${id}`, 'GET', token);
}

/** Matches VoiceCapabilitiesDto. */
export interface VoiceCapabilities {
  /** False when the assistant itself is unconfigured — voice is pointless then. */
  voiceAvailable: boolean;
  /** False when no Azure Speech key is present; the client should speak replies locally instead. */
  serverTtsAvailable: boolean;
  /** Sample rate of the PCM the server streams, needed to build AudioBuffers. */
  sampleRate: number;
}

/**
 * Ask what the voice pipeline can do before opening a hub connection, so the widget can
 * hide the mic entirely rather than failing after the user clicks it.
 */
export function getVoiceCapabilities(token: string): Promise<VoiceCapabilities> {
  return request<VoiceCapabilities>('/api/assistant/voice/capabilities', 'GET', token);
}
