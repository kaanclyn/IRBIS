import { CHART_SCHEMES, SCHEME_LABELS, type ChartScheme } from "../chart/scheme";

export function SchemeSwitcher({
  value,
  onChange,
  compact = false,
}: {
  value: ChartScheme;
  onChange: (s: ChartScheme) => void;
  compact?: boolean;
}) {
  return (
    <div
      className={`scheme-switch${compact ? " compact" : ""}`}
      role="group"
      aria-label="Harita renk şeması"
    >
      {CHART_SCHEMES.map((s) => (
        <button
          key={s}
          type="button"
          className={value === s ? "active" : undefined}
          aria-pressed={value === s}
          title={SCHEME_LABELS[s]}
          onClick={() => onChange(s)}
        >
          {compact ? s.charAt(0).toUpperCase() + s.slice(1) : SCHEME_LABELS[s]}
        </button>
      ))}
    </div>
  );
}
