import { DataFactory, Parser, Writer } from "n3";
import { decodeUtf8Source, defineSourceCodec, encodeUtf8Source } from "@red-cup-engineering/signcell/source-codec";

const MAX_TRIPLES = 32768;
const XSD_STRING = "http://www.w3.org/2001/XMLSchema#string";
const RDF_LANGUAGE_STRING = "http://www.w3.org/1999/02/22-rdf-syntax-ns#langString";
const LANGUAGE = /^[a-z]+(?:-[a-z0-9]+)*$/iu;
const BAD_IRI = /[\u0000-\u0020<>"{}|^`\\]|%(?![\da-f]{2})/iu;

function scalarText(value) {
  if (typeof value !== "string" || !value.isWellFormed()) throw new TypeError("RDF terms require Unicode scalar text");
  return value;
}

function absoluteIri(value) {
  if (!/^[a-z][a-z0-9+.-]*:/iu.test(scalarText(value)) || BAD_IRI.test(value))
    throw new TypeError(`Turtle requires an absolute RDF IRI: ${JSON.stringify(value)}`);
  return value;
}

function localBlankNodes() {
  const labels = new Map();
  return value => {
    if (!labels.has(value)) labels.set(value, `b${labels.size}`);
    return labels.get(value);
  };
}

function readTerm(term, blank) {
  switch (term.termType) {
    case "NamedNode": return { kind: "iri", value: absoluteIri(term.value) };
    case "BlankNode": return { kind: "blank", value: blank(term.value) };
    case "Literal": {
      const value = scalarText(term.value);
      if (term.direction) throw new TypeError("Turtle source uses RDF 1.1 literals");
      if (term.language) return { kind: "literal", value, language: term.language.toLowerCase() };
      const datatype = absoluteIri(term.datatype.value);
      return datatype === XSD_STRING ? { kind: "literal", value } : { kind: "literal", value, datatype };
    }
    default: throw new TypeError(`Turtle source uses RDF 1.1 terms: ${term.termType}`);
  }
}

/** Parse one Turtle source using its own base directives and preserve RDF term types. */
export function readTurtleDocument(text) {
  let count = 0;
  const factory = {
    ...DataFactory,
    quad(...args) {
      if (++count > MAX_TRIPLES) throw new RangeError(`Turtle exceeds ${MAX_TRIPLES} triples`);
      return DataFactory.quad(...args);
    },
  };
  const parser = new Parser({ format: "Turtle", blankNodePrefix: "source_", version: "1.1", factory });
  const blank = localBlankNodes();
  return parser.parse(scalarText(text).replace(/^\uFEFF/u, "")).map(({ subject, predicate, object }) =>
    ({ s: readTerm(subject, blank), p: readTerm(predicate, blank), o: readTerm(object, blank) }));
}

function writeTerm(term, position, blank) {
  if (!term || Object.getPrototypeOf(term) !== Object.prototype || typeof term.kind !== "string")
    throw new TypeError(`Turtle requires an RDF term at ${position}`);
  const allowed = term.kind === "literal" ? ["kind", "value", "language", "datatype"] : ["kind", "value"];
  if (Object.keys(term).some(key => !allowed.includes(key)))
    throw new TypeError(`unexpected RDF term field at ${position}`);
  const value = scalarText(term.value);
  if (term.kind === "iri") return DataFactory.namedNode(absoluteIri(value));
  if (term.kind === "blank" && position !== "predicate" && value) return DataFactory.blankNode(blank(value));
  if (term.kind !== "literal" || position !== "object") throw new TypeError(`invalid RDF ${position}`);
  const { language, datatype } = term;
  if (language !== undefined) {
    if (datatype !== undefined || typeof language !== "string" || !LANGUAGE.test(language))
      throw new TypeError("RDF literal language requires a language tag");
    return DataFactory.literal(value, language.toLowerCase());
  }
  if (datatype === RDF_LANGUAGE_STRING) throw new TypeError("RDF langString requires a language tag");
  return datatype === undefined ? DataFactory.literal(value) : DataFactory.literal(value, DataFactory.namedNode(absoluteIri(datatype)));
}

/** Emit legal Turtle statements with local blank labels and no external base. */
export function writeTurtleDocument(triples) {
  if (!Array.isArray(triples)) throw new TypeError("Turtle requires an array of RDF triples");
  if (triples.length > MAX_TRIPLES) throw new RangeError(`Turtle exceeds ${MAX_TRIPLES} triples`);
  const blank = localBlankNodes();
  const quads = triples.map(triple => {
    if (!triple || Object.getPrototypeOf(triple) !== Object.prototype ||
        Object.keys(triple).length !== 3 || !["s", "p", "o"].every(key => Object.hasOwn(triple, key)))
      throw new TypeError("Turtle triple requires s, p and o");
    return DataFactory.quad(writeTerm(triple.s, "subject", blank), writeTerm(triple.p, "predicate", blank),
      writeTerm(triple.o, "object", blank));
  });
  return new Writer({ format: "N-Triples" }).quadsToString(quads);
}

export const turtleSourceCodec = defineSourceCodec({
  id: "turtle.rdf-triples/v1", mediaType: "text/turtle", maxBytes: 1048576, valueIdentity: "exact",
  decode: bytes => readTurtleDocument(decodeUtf8Source(bytes)),
  encode: triples => encodeUtf8Source(writeTurtleDocument(triples)),
});
