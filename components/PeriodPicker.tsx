"use client";

/** Start and end month/year selection, bounded by the selected products' coverage. */
import { useId } from "react";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

interface PeriodProps {
  start: string;
  end: string;
  minYear: number;
  maxYear: number;
  onChange: (period: { start: string; end: string }) => void;
}

function MonthYear({ label, value, minYear, maxYear, onChange }: { label: string; value: string; minYear: number; maxYear: number; onChange: (v: string) => void }) {
  const id = useId();
  const [year, month] = value.split("-");
  const years = Array.from({ length: maxYear - minYear + 1 }, (_, i) => String(maxYear - i));
  return (
    <fieldset>
      <legend>{label}</legend>
      <div className="inline-pair">
        <div>
          <label htmlFor={`${id}-m`} className="visually-hidden">
            {label} month
          </label>
          <select id={`${id}-m`} value={month} onChange={(e) => onChange(`${year}-${e.target.value}`)}>
            {MONTHS.map((name, i) => (
              <option key={name} value={String(i + 1).padStart(2, "0")}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-y`} className="visually-hidden">
            {label} year
          </label>
          <select id={`${id}-y`} value={year} onChange={(e) => onChange(`${e.target.value}-${month}`)}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      </div>
    </fieldset>
  );
}

export function PeriodPicker({ start, end, minYear, maxYear, onChange }: PeriodProps) {
  return (
    <div className="period-grid">
      <MonthYear label="Start" value={start} minYear={minYear} maxYear={maxYear} onChange={(v) => onChange({ start: v, end })} />
      <MonthYear label="End" value={end} minYear={minYear} maxYear={maxYear} onChange={(v) => onChange({ start, end: v })} />
    </div>
  );
}
