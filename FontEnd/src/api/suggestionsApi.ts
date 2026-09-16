/**
 * Budget-suggestion API — talks to SuggestionsController (Slice A).
 *
 * Endpoint inventory:
 *   POST /api/suggestions/budget        → tiered, budget-fitting proposals (stateless)
 *   POST /api/suggestions/materialize   → turn a chosen proposal into a Draft booking
 *   POST /api/suggestions/quote         → price an edited plan (anonymous, nothing saved)
 *   POST /api/suggestions/checkout      → place a plan as a submitted booking, all or nothing
 *
 * THE GOLDEN RULE (frontend): every price/subtotal/tax/total/remainingBudget shown
 * is rendered exactly as the backend returned it — never recomputed client-side.
 */

import type { ServiceScope, ServingStyle } from '../lib/serviceScope';
import { notifyUnauthorized } from '../lib/authEvents';

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5258'
).replace(/\/+$/, '');

// ── Error class ────────────────────────────────────────────────────────

export class SuggestionsApiError extends Error {
  readonly status: number | null;
  /** Every reason a plan checkout was refused, when the server listed them. */
  readonly problems: string[];

  constructor(message: string, status: number | null = null, problems: string[] = []) {
    super(message);
    this.name = 'SuggestionsApiError';
    this.status = status;
    this.problems = problems;
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

/**
 * Matches PlanEventDetailsDto: the event-type-specific details and motif/theme text a
 * plan built in the booking wizard carries. Only the fields matching the event type
 * should be set; the quote reports any that don't fit.
 */
export interface PlanEventDetails {
  groomName?: string | null;
  brideName?: string | null;
  celebrantName?: string | null;
  celebrantSex?: string | null;
  celebrantAge?: number | null;
  eventName?: string | null;
  motif?: string | null;
  theme?: string | null;
  /* Optional: a plan saved to the cart before these existed has none, and the server
     only demands a serving style once a scope is sent. */
  serviceScope?: ServiceScope | null;
  servingStyle?: ServingStyle | null;
  dietaryRequirements?: string | null;
}

/** Matches MaterializeRequest — also the recipe a planned booking keeps in the cart. */
export interface MaterializeRequest {
  bookingType: 'FullService' | 'FoodDelivery' | 'RentalService';
  eventDate: string;                              // "YYYY-MM-DD"
  startTime: string;                              // "HH:mm:ss"
  endDate?: string | null;
  endTime?: string | null;
  eventType?: string | null;
  venueAddress: string;
  guestCount?: number | null;
  contactNumber?: string | null;
  eventDetails?: PlanEventDetails | null;
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

/**
 * Matches QuoteRequest. The times are optional: send them (with endDate and eventType
 * for an event) and the quote also judges the date and time the way booking creation
 * would, reporting it as `headerProblem`.
 */
export interface QuoteRequest {
  bookingType: 'FullService' | 'FoodDelivery' | 'RentalService';
  eventDate: string;                              // "YYYY-MM-DD"
  endDate?: string | null;
  guestCount?: number | null;
  startTime?: string | null;                      // "HH:mm:ss"
  endTime?: string | null;
  eventType?: string | null;
  eventDetails?: PlanEventDetails | null;
  proposal: MaterializeProposal;
}

/**
 * Matches QuoteLineDto. A non-null `problem` means the booking would refuse this
 * line; it is left out of the totals.
 */
export interface QuoteLine {
  type: string;        // "Package" | "MenuItem" | "MenuTray" | "Service" | "Rental"
  refId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  problem: string | null;
}

/** Matches QuoteSlotDto — one package course and the dishes chosen for it. */
export interface QuoteSlot {
  slotId: string;
  slotLabel: string;
  chooseCount: number;
  itemIds: string[];
  itemNames: string[];
  problem: string | null;
}

/** Matches QuoteResponse. All money values are authoritative — render as-is. */
export interface QuoteResponse {
  lines: QuoteLine[];
  packageSlots: QuoteSlot[];
  problems: string[];
  /** Why the date, time or guest count would be refused; null when fine or not sent. */
  headerProblem: string | null;
  subtotal: number;
  tax: number;
  total: number;
  canCheckout: boolean;
}

/** Matches CheckoutResultDto — the plan, placed as a submitted booking. */
export interface CheckoutResult {
  bookingId: string;
  bookingName: string;
  totalAmount: number;
}

// ── Internal helpers (copied from bookingApi.ts's shape) ─────────────────

async function readErrorBody(res: Response): Promise<{ message: string | null; problems: string[] }> {
  try {
    const body = (await res.json()) as any;
    const problems = Array.isArray(body.problems)
      ? body.problems.filter((p: unknown): p is string => typeof p === 'string')
      : [];
    if (typeof body.message === 'string') return { message: body.message, problems };
    if (body.errors && typeof body.errors === 'object') {
      const firstKey = Object.keys(body.errors)[0];
      if (firstKey && Array.isArray(body.errors[firstKey]) && body.errors[firstKey].length > 0) {
        return { message: body.errors[firstKey][0], problems };
      }
    }
    return { message: null, problems };
  } catch {
    return { message: null, problems: [] };
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
    /* No Authorization header at all for a guest. `Bearer ` with an empty token is a
       malformed credential rather than an absent one (see fetchPublicMenuItems), and
       the anonymous endpoints here, /budget and /quote, are called exactly that way. */
    const options: RequestInit = {
      method,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
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
    /* 401 only: the token is dead, so AuthProvider ends the session. A 403 is a
       live token without the rights for this call and must not sign anyone out. */
    if (res.status === 401) notifyUnauthorized();
    throw new SuggestionsApiError(
      'Your session has expired or you lack permission. Please sign in again.',
      res.status,
    );
  }

  if (!res.ok) {
    const { message, problems } = await readErrorBody(res);
    throw new SuggestionsApiError(
      message ?? `The server responded with an error (HTTP ${res.status}).`,
      res.status,
      problems,
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

/** Price an edited plan. Anonymous: pass '' when signed out. Nothing is saved. */
export function quoteProposal(token: string, req: QuoteRequest): Promise<QuoteResponse> {
  return request<QuoteResponse>('/api/suggestions/quote', 'POST', token, req);
}

/**
 * Place a plan as a submitted booking, all or nothing. A refusal is a
 * SuggestionsApiError whose `problems` lists everything that needs fixing.
 */
export function checkoutPlan(token: string, req: MaterializeRequest): Promise<CheckoutResult> {
  return request<CheckoutResult>('/api/suggestions/checkout', 'POST', token, req);
}
