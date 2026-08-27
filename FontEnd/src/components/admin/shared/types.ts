/** Contracts shared by the admin tables (bookings, payments). */

/** One entry in a row's action dropdown. */
export interface ActionItem {
  key: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  /** Rendered as the item's title attribute — used to explain why it's disabled. */
  hint?: string;
  /** Renders in the danger colour and sits below a divider. */
  danger?: boolean;
}
