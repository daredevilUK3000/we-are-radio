// A simple single-select chip row - deliberately not the Studio's ChipPicker
// (which allows free-text custom entries): the brief calls for "a simple
// tappable UI, not a free-text box" for the listener session builder.
export function SelectChips<T extends string | number>({
  options,
  value,
  onChange,
  labels,
}: {
  options: T[];
  value: T | null;
  onChange: (next: T) => void;
  labels?: (option: T) => string;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          className={`chip${value === opt ? " selected" : ""}`}
          onClick={() => onChange(opt)}
        >
          {labels ? labels(opt) : opt}
        </button>
      ))}
    </div>
  );
}
