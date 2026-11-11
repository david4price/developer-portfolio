export type StatusTone = 'positive' | 'neutral' | 'warning' | 'unknown';

export interface StatusBadgeProps {
  readonly tone: StatusTone;
  readonly label: string;
}

/** Status is conveyed by text, never by color alone. */
export function StatusBadge({ tone, label }: StatusBadgeProps) {
  return (
    <span className={`ui-status ui-status--${tone}`} role="status">
      {label}
    </span>
  );
}
