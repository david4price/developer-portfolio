export interface TechListProps {
  readonly items: readonly string[];
  readonly label?: string;
}

export function TechList({ items, label = 'Technologies' }: TechListProps) {
  return (
    <ul className="ui-tech-list" aria-label={label}>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}
