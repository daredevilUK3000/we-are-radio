import { useState } from "react";

/**
 * Toggle-able preset chips with a custom-entry fallback, so common values
 * are a click instead of typing, but the tag/genre vocabulary can still grow
 * (Section 5 of the brief: moods are a flexible, growable set, not a fixed
 * enum).
 */
export function ChipPicker({
  options,
  value,
  onChange,
  multi = true,
  customPlaceholder = "Add custom...",
}: {
  options: string[];
  value: string[];
  onChange: (next: string[]) => void;
  multi?: boolean;
  customPlaceholder?: string;
}) {
  const [customText, setCustomText] = useState("");

  const selectedStyle = { background: "var(--accent)", borderColor: "var(--accent)", color: "#fff" };

  const toggle = (option: string) => {
    if (multi) {
      onChange(value.includes(option) ? value.filter((v) => v !== option) : [...value, option]);
    } else {
      onChange(value.includes(option) ? [] : [option]);
    }
  };

  const addCustom = () => {
    const v = customText.trim();
    if (!v) return;
    onChange(multi ? [...value.filter((x) => x !== v), v] : [v]);
    setCustomText("");
  };

  const customValues = value.filter((v) => !options.includes(v));

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            className="btn"
            onClick={() => toggle(opt)}
            style={value.includes(opt) ? selectedStyle : undefined}
          >
            {opt}
          </button>
        ))}
        {customValues.map((v) => (
          <button
            key={v}
            type="button"
            className="btn"
            onClick={() => onChange(value.filter((x) => x !== v))}
            style={selectedStyle}
            title="Click to remove"
          >
            {v} ×
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <input
          value={customText}
          onChange={(e) => setCustomText(e.target.value)}
          placeholder={customPlaceholder}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addCustom();
            }
          }}
        />
        <button type="button" className="btn" onClick={addCustom}>
          Add
        </button>
      </div>
    </div>
  );
}
