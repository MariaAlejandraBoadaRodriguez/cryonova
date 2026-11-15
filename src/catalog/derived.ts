/**
 * Derived series asked for by the original 22-topic catalog: differences
 * between two fields and magnitudes of mean wind vectors. They are computed
 * from the monthly regional means of verified catalog variables of the same
 * collection (identical grids and valid cells), so no new provider request is
 * made and every input keeps its own provenance.
 */
import type { CatalogVariable, DisplayUnits, Localized } from "./types";

export type DerivedOp = "difference" | "vector-magnitude" | "vector-difference-magnitude";

export interface DerivedMetric {
  key: string;
  op: DerivedOp;
  /**
   * difference: [a, b] gives a − b.
   * vector-magnitude: [u, v] gives √(u² + v²).
   * vector-difference-magnitude: [u1, v1, u2, v2] gives √((u1 − u2)² + (v1 − v2)²).
   */
  inputs: string[];
  formula: string;
  name: Localized;
  description: Localized;
  /** Display units of the inputs (all inputs share them); offsets cancel in differences. */
  display: DisplayUnits;
}

const temperature: DisplayUnits = { units: "°C", scale: 1, offset: 0, trendUnits: "°C/decade", group: "temperature", decimals: 2 };
const humidity: DisplayUnits = { units: "g/kg", scale: 1, offset: 0, trendUnits: "g/kg per decade", group: "specific_humidity", decimals: 3 };
const wind: DisplayUnits = { units: "m/s", scale: 1, offset: 0, trendUnits: "m/s per decade", group: "wind", decimals: 3 };
const meters: DisplayUnits = { units: "m", scale: 1, offset: 0, trendUnits: "m/decade", group: "height", decimals: 1 };
const pressure: DisplayUnits = { units: "hPa", scale: 1, offset: 0, trendUnits: "hPa/decade", group: "pressure", decimals: 2 };

const m = (key: string, op: DerivedOp, inputs: string[], formula: string, display: DisplayUnits, name: Localized, description: Localized): DerivedMetric => ({ key: `derived.${key}`, op, inputs, formula, display, name, description });

export const DERIVED: DerivedMetric[] = [
  m("TS-T2M", "difference", ["merra2.TS", "merra2.T2M"], "TS − T2M", temperature,
    { en: "Surface minus 2 m air temperature", es: "Superficie menos temperatura del aire a 2 m" },
    { en: "Surface skin temperature minus air temperature at 2 m.", es: "Temperatura de la superficie menos la temperatura del aire a 2 m." }),
  m("T10M-T2M", "difference", ["merra2.T10M", "merra2.T2M"], "T10M − T2M", temperature,
    { en: "Air temperature difference, 10 m minus 2 m", es: "Diferencia de temperatura del aire, 10 m menos 2 m" },
    { en: "Air temperature at 10 m minus air temperature at 2 m.", es: "Temperatura del aire a 10 m menos la temperatura a 2 m." }),
  m("QV10M-QV2M", "difference", ["merra2.QV10M", "merra2.QV2M"], "QV10M − QV2M", humidity,
    { en: "Specific humidity difference, 10 m minus 2 m", es: "Diferencia de humedad específica, 10 m menos 2 m" },
    { en: "Specific humidity at 10 m minus specific humidity at 2 m.", es: "Humedad específica a 10 m menos la humedad específica a 2 m." }),
  m("T2M-T2MDEW", "difference", ["merra2.T2M", "merra2.T2MDEW"], "T2M − T2MDEW", temperature,
    { en: "Air temperature minus dew point at 2 m", es: "Temperatura del aire menos punto de rocío a 2 m" },
    { en: "How far air temperature is above the dew point at 2 m (dew-point depression).", es: "Cuánto supera la temperatura del aire al punto de rocío a 2 m (depresión del punto de rocío)." }),
  m("WIND2M", "vector-magnitude", ["merra2.U2M", "merra2.V2M"], "√(U2M² + V2M²)", wind,
    { en: "Magnitude of the mean wind vector at 2 m", es: "Magnitud del vector de viento medio a 2 m" },
    { en: "Speed of the regional mean wind vector at 2 m, from its eastward and northward components.", es: "Rapidez del vector de viento medio regional a 2 m, a partir de sus componentes este y norte." }),
  m("WIND10M-50M", "vector-difference-magnitude", ["merra2.U10M", "merra2.V10M", "merra2.U50M", "merra2.V50M"], "|(U10M, V10M) − (U50M, V50M)|", wind,
    { en: "Wind vector difference between 10 m and 50 m", es: "Diferencia del vector de viento entre 10 m y 50 m" },
    { en: "Magnitude of the difference between the mean wind vectors at 10 m and 50 m.", es: "Magnitud de la diferencia entre los vectores de viento medio a 10 m y 50 m." }),
  m("WIND850-250", "vector-difference-magnitude", ["merra2.U850", "merra2.V850", "merra2.U250", "merra2.V250"], "|(U850, V850) − (U250, V250)|", wind,
    { en: "Wind vector difference between 850 and 250 hPa", es: "Diferencia del vector de viento entre 850 y 250 hPa" },
    { en: "Magnitude of the difference between the mean wind vectors at 850 and 250 hPa (deep-layer shear).", es: "Magnitud de la diferencia entre los vectores de viento medio a 850 y 250 hPa (cizalladura)." }),
  m("WIND500", "vector-magnitude", ["merra2.U500", "merra2.V500"], "√(U500² + V500²)", wind,
    { en: "Magnitude of the mean wind vector at 500 hPa", es: "Magnitud del vector de viento medio a 500 hPa" },
    { en: "Speed of the regional mean wind vector at 500 hPa.", es: "Rapidez del vector de viento medio regional a 500 hPa." }),
  m("H850-H1000", "difference", ["merra2.H850", "merra2.H1000"], "H850 − H1000", meters,
    { en: "Thickness of the 1000–850 hPa layer", es: "Espesor de la capa 1000–850 hPa" },
    { en: "Vertical distance between the 1000 and 850 hPa levels.", es: "Distancia vertical entre los niveles de 1000 y 850 hPa." }),
  m("H500-H850", "difference", ["merra2.H500", "merra2.H850"], "H500 − H850", meters,
    { en: "Thickness of the 850–500 hPa layer", es: "Espesor de la capa 850–500 hPa" },
    { en: "Vertical distance between the 850 and 500 hPa levels.", es: "Distancia vertical entre los niveles de 850 y 500 hPa." }),
  m("H250-H500", "difference", ["merra2.H250", "merra2.H500"], "H250 − H500", meters,
    { en: "Thickness of the 500–250 hPa layer", es: "Espesor de la capa 500–250 hPa" },
    { en: "Vertical distance between the 500 and 250 hPa levels.", es: "Distancia vertical entre los niveles de 500 y 250 hPa." }),
  m("PS-PBLTOP", "difference", ["merra2.PS", "merra2.PBLTOP"], "PS − PBLTOP", pressure,
    { en: "Pressure depth of the boundary layer (PS − PBLTOP)", es: "Profundidad en presión de la capa límite (PS − PBLTOP)" },
    { en: "Surface pressure minus the pressure at the top of the boundary layer.", es: "Presión en superficie menos la presión en la cima de la capa límite." }),
];

export function getDerived(key: string): DerivedMetric | undefined {
  return DERIVED.find((d) => d.key === key);
}

/** Derived metrics whose inputs are all among the selected variables. */
export function applicableDerived(variables: string[]): DerivedMetric[] {
  const selected = new Set(variables);
  return DERIVED.filter((d) => d.inputs.every((k) => selected.has(k)));
}

/**
 * Monthly derived values from the inputs' monthly regional means (display
 * units). A month is computed only when every input has a value; its valid
 * cell count is the smallest among the inputs.
 */
export function derivePoints(
  metric: DerivedMetric,
  inputs: Array<Array<{ month: string; value: number | null; validCells: number; totalCells: number }>>,
): Array<{ month: string; value: number | null; validCells: number; totalCells: number }> {
  const first = inputs[0] ?? [];
  return first.map((point, i) => {
    const values = inputs.map((series) => series[i]?.value ?? null);
    const complete = values.every((v): v is number => v !== null && Number.isFinite(v)) && inputs.every((series) => series[i]?.month === point.month);
    let value: number | null = null;
    if (complete) {
      const [a, b, c, d] = values as number[];
      if (metric.op === "difference") value = a! - b!;
      else if (metric.op === "vector-magnitude") value = Math.hypot(a!, b!);
      else value = Math.hypot(a! - c!, b! - d!);
    }
    return { month: point.month, value, validCells: complete ? Math.min(...inputs.map((s) => s[i]!.validCells)) : 0, totalCells: point.totalCells };
  });
}

/**
 * The analysis engine works on catalog variables; a derived series is
 * presented as one whose values are already in display units (scale 1,
 * offset 0), so its statistics are computed exactly like any other series.
 */
export function derivedVariable(metric: DerivedMetric, firstInput: CatalogVariable): CatalogVariable {
  return {
    key: metric.key,
    source: firstInput.source,
    collection: firstInput.collection,
    dapName: metric.formula,
    name: metric.name,
    description: metric.description,
    providerLongName: metric.description.en,
    providerUnits: metric.display.units,
    fillValue: Number.NaN,
    display: { ...metric.display, scale: 1, offset: 0 },
    domain: firstInput.domain,
    frequency: "monthly",
    aggregation: `Derived each month from the regional means of ${metric.inputs.map((k) => k.replace(/^.*\./, "")).join(", ")}: ${metric.formula}.`,
    words: { en: [], es: [] },
    phrases: { en: [], es: [] },
    role: "primary",
    verified: { method: "Derived from live-verified inputs of one collection", date: firstInput.verified.date },
  };
}
