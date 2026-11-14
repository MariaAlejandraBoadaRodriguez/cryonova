/** Lightweight English/Spanish detection (client-safe; no catalog imports). */
import type { Language } from "./proposal";

const SPANISH = /[¿¡ñáéíóú]|\b(el|la|los|las|en|entre|desde|hasta|cambi[oó]|lluvia|temperatura|humedad|suelo|cu[aá]nto|c[oó]mo|qu[eé]|hay|regi[oó]n)\b/i;

export function detectLanguage(text: string): Language {
  return SPANISH.test(text) ? "es" : "en";
}
