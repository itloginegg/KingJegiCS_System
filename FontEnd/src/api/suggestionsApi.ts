/**
 * Budget-suggestion API — talks to SuggestionsController (Slice A).
 *
 * Endpoint inventory:
 *   POST /api/suggestions/budget        → tiered, budget-fitting proposals (stateless)
 *   POST /api/suggestions/materialize   → turn a chosen proposal into a Draft booking
 *
 * THE GOLDEN RULE (frontend): every price/subtotal/tax/total/remainingBudget shown
 * is rendered exactly as the backend returned it — never recomputed client-side.
 */

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5258'
).replace(/\/+$/, '');

// ── Error class ────────────────────────────────────────────────────────

export class SuggestionsApiError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'SuggestionsApiError';
    this.status = status;
  }

  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

// ── Types ──────────────────────────────────────────────────────────────

/** Matches SuggestionPreferencesDto. */
export interface SuggestionPreferences {
  dietaryTags?: string[] | null;
  avoidItemCategories?: string[] | null;
}

/** Matches BudgetSuggestionRequest. */
export interface BudgetSuggestionRequest {
  budget: number;
  guestCount: number;
  eventDate: string;                              // "YYYY-MM-DD"
  bookingType: 'FullService' | 'FoodDelivery';
  eventType?: string | null;                      // "Wedding" | "Corporate" | "Birthday" | "Others"
  preferences?: SuggestionPreferences | null;
}

/** Matches ProposalLineDto. */
export interface ProposalLine {
  type: string;        // "Package" | "MenuItem" | "MenuTray" | "Service" | "Rental"
  refId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

/** Matches ProposalSlotSelectionDto. */
export interface ProposalSlotSelection {
  slotId: string;
  slotLabel: string;
  itemIds: string[];
  itemNames: string[];
}

/** Matches ProposalDto. All money values are authoritative — render as-is. */
export interface Proposal {
  tier: string;                                   // "Essential" | "Balanced" | "Premium"
  lines: ProposalLine[];
  packageSlotSelections: ProposalSlotSelection[];
  foodCoverageForGuests: number;
  subtotal: number;
  tax: number;
  total: number;
  remainingBudget: number;
  rationale: string;
}

/** Matches SuggestionSetResponse. */
export interface SuggestionSetResponse {
  proposals: Proposal[];
  note: string | null;
}

/** Matches MaterializeLineDto (the Package line is dropped — its id travels as packageId). */
export interface MaterializeLine {
  type: string;        // "MenuItem" | "MenuTray" | "Service" | "Rental"
  refId: string;
  quantity: number;
}

/** Matches MaterializeSlotSelectionDto. */
export interface MaterializeSlotSelection {
  slotId: string;
  itemIds: string[];
}

/** Matches MaterializeProposalDto. */
export interface MaterializeProposal {
  packageId?: string | null;
  lines: MaterializeLine[];
  packageSlotSelections: MaterializeSlotSelection[];
}

/** Matches MaterializeRequest. */
export interface MaterializeRequest {
  bookingType: 'FullService' | 'FoodDelivery';
  eventDate: string;                              // "YYYY-MM-DD"
  startTime: string;                              // "HH:mm:ss"
  endDate?: string | null;
  endTime?: string | null;
  eventType?: string | null;
  venueAddress: string;
  guestCount?: number | null;
  contactNumber?: string | null;
  proposal: MaterializeProposal;
}

/** Matches DroppedLineDto. */
export interface DroppedLine {
  type: string;
  refId: string;
  reason: string;
}

/** Matches MaterializeResultDto. */
export interface MaterializeResult {
  bookingId: string;
  bookingName: string;
  totalAmount: number;
  addedLineCount: number;
  droppedLines: DroppedLine[];
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
    throw new SuggestionsApiError(
      'Unable to reach the server. Make sure the backend is running, then try again.',
    );
  }

  if (res.status === 401 || res.status === 403) {
    throw new SuggestionsApiError(
      'Your session has expired or you lack permission. Please sign in again.',
      res.status,
    );
  }

  if (!res.ok) {
    const message = await readErrorMessage(res);
    throw new SuggestionsApiError(
      message ?? `The server responded with an error (HTTP ${res.status}).`,
      res.status,
    );
  }

  if (res.status === 204) return {} as T;
  return (await res.json()) as T;
}

// ── Public API ─────────────────────────────────────────────────────────

/** Generate 2-3 tiered proposals that each fit the budget (stateless — nothing is saved). */
export function getBudgetSuggestions(
  token: string,
  req: BudgetSuggestionRequest,
): Promise<SuggestionSetResponse> {
  return request<SuggestionSetResponse>('/api/suggestions/budget', 'POST', token, req);
}

/** Turn a chosen proposal into a Draft booking (goes through all existing booking guards). */
export function materializeProposal(
  token: string,
  req: MaterializeRequest,
): Promise<MaterializeResult> {
  return request<MaterializeResult>('/api/suggestions/materialize', 'POST', token, req);
}
