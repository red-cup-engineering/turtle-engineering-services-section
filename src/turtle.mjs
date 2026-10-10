/**
 * codecs/text/turtle — the Turtle RDF document codec.
 *
 * `iriRef` and `turtleLiteral` are the term writers (IRIREF and literal
 * escaping). `subjectIri`/`predicateIri`/`vocabularyNamespace` are the IRI
 * law: they turn an admitted {@link Triple}'s bare `s`/`p` values into
 * dereferenceable addresses under a base, the way any linked-data vocabulary
 * downstream needs. `writeTurtle`/`parseTurtle` are the document codec proper:
 * the normal form they commit to is one statement per line —
 * `<s> <p> <o-or-literal> .` — a legal subset of both Turtle and N-Triples.
 * `writeTurtle` proves every admitted {@link Triple} round-trips through
 * `parseTurtle` back to itself; `parseTurtle` rejects any line outside that
 * exact grammar rather than guessing at a richer one.
 */
import { assertTriple } from "@red-cup-engineering/eavt-services-section/triple";

/** Write an IRI as a Turtle IRIREF `<...>`. */
export function iriRef(iri) {
  return `<${String(iri).replace(/[- <>"{}|^`\\]/g, encodeURIComponent)}>`;
}

/** Write a value as a Turtle literal. */
export function turtleLiteral(value) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  const escaped = String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
  return `"${escaped}"`;
}

function ensureSlash(base) {
  return base.endsWith("/") ? base : `${base}/`;
}

/** The vocabulary namespace under a base: `<base>vocab#`. */
export function vocabularyNamespace(base = "/") {
  return `${ensureSlash(base)}vocab#`;
}

/** The predicate namespace under a base: `<base>vocab/predicate#`. */
export function predicateNamespace(base = "/") {
  return `${ensureSlash(base)}vocab/predicate#`;
}

function addressSegment(value, role) {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new TypeError(`turtle: a Triple's ${role} must be a string or number to address as an IRI, got ${typeof value}`);
  }
  return encodeURIComponent(String(value));
}

/** The dereferenceable IRI for a Triple's subject under a base. */
export function subjectIri(base, subject) {
  return `${ensureSlash(base)}${addressSegment(subject, "subject")}`;
}

/** The dereferenceable IRI for a Triple's predicate under a base. */
export function predicateIri(base, predicate) {
  return `${predicateNamespace(base)}${addressSegment(predicate, "predicate")}`;
}

/** Whether a JSON value is a string shaped like an absolute IRI/URL. */
export function isIriTerm(value) {
  return typeof value === "string" && /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

/** Reject Triples this codec cannot write: RDF terms must be scalar. */
export function assertScalarTriple(value) {
  const triple = assertTriple(value);
  for (const [role, term] of [["s", triple.s], ["p", triple.p], ["o", triple.o]]) {
    if (term === null || typeof term === "object") {
      throw new TypeError(`turtle: triple.${role} must be a string, number, or boolean scalar, got ${term === null ? "null" : Array.isArray(term) ? "array" : "object"}`);
    }
  }
  return triple;
}

// Subject and predicate positions in Turtle admit only IRIs (or blank nodes,
// which this codec does not write): a bare identifier is addressed under
// `base` via subjectIri/predicateIri; a value already IRI-shaped is used as
// is. The object position may additionally be a literal, or a reference to
// another subject in the same graph (mirrors the JSON-LD codec's grouping).
function subjectTerm(base, value) {
  return iriRef(isIriTerm(value) ? value : subjectIri(base, value));
}

function predicateTerm(base, value) {
  return iriRef(isIriTerm(value) ? value : predicateIri(base, value));
}

function objectTerm(base, value, subjects) {
  if (typeof value === "string" && subjects.has(value)) return iriRef(subjectIri(base, value));
  return isIriTerm(value) ? iriRef(value) : turtleLiteral(value);
}

/**
 * Write admitted Triples as one Turtle/N-Triples statement per line, subject
 * and predicate addressed as IRIs under `base` (default `/`).
 */
export function writeTurtle(triples, opts = {}) {
  const base = opts.base ?? "/";
  const admitted = triples.map((value) => assertScalarTriple(value));
  const subjects = new Set(admitted.map((triple) => String(triple.s)));
  const lines = admitted.map((triple) =>
    `${subjectTerm(base, triple.s)} ${predicateTerm(base, triple.p)} ${objectTerm(base, triple.o, subjects)} .`);
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

const IRI_TERM = /^<([^>]*)>$/;
const STRING_TERM = /^"((?:[^"\\]|\\.)*)"$/;
const STATEMENT = /^(\S+)\s+(\S+)\s+(.+?)\s*\.$/;

function stripPrefix(prefix, iri) {
  return iri.startsWith(prefix) ? decodeURIComponent(iri.slice(prefix.length)) : iri;
}

function parseSubject(text, base) {
  const iri = text.match(IRI_TERM);
  if (!iri) throw new TypeError(`turtle: subject term is not a member of this codec's normal form (must be an IRI): ${text}`);
  return stripPrefix(ensureSlash(base), decodeURIComponent(iri[1]));
}

function parsePredicate(text, base) {
  const iri = text.match(IRI_TERM);
  if (!iri) throw new TypeError(`turtle: predicate term is not a member of this codec's normal form (must be an IRI): ${text}`);
  return stripPrefix(predicateNamespace(base), decodeURIComponent(iri[1]));
}

function parseObject(text, base) {
  const iri = text.match(IRI_TERM);
  if (iri) return stripPrefix(ensureSlash(base), decodeURIComponent(iri[1]));
  const literal = text.match(STRING_TERM);
  if (literal) {
    return literal[1]
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
  if (text === "true" || text === "false") return text === "true";
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  throw new TypeError(`turtle: object term is not a member of this codec's normal form: ${text}`);
}

/**
 * Parse the codec's committed Turtle normal form back into Triples under the
 * same `base` writeTurtle used, rejecting any statement outside
 * `<s> <p> <o> .` (one per line). Subject/predicate identity recovers as the
 * address's decoded string; object recovers with its original JSON type.
 */
export function parseTurtle(document, opts = {}) {
  const base = opts.base ?? "/";
  const lines = document.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  return lines.map((line, index) => {
    const match = line.match(STATEMENT);
    if (!match) throw new TypeError(`turtle: line ${index + 1} is not a member of this codec's normal form: ${line}`);
    const [, s, p, o] = match;
    return assertTriple({ s: parseSubject(s, base), p: parsePredicate(p, base), o: parseObject(o, base) });
  });
}
