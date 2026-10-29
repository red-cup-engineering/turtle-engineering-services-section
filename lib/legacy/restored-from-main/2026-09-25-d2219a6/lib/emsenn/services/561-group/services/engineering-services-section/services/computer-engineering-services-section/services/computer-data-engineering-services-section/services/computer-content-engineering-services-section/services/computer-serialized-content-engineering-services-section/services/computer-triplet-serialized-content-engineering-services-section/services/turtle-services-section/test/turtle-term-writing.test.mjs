import assert from "node:assert/strict";
import test from "node:test";
import { iriRef, turtleLiteral } from "@red-cup-engineering/turtle-services-section/turtle-term-writing";

test("writes the recovered Turtle IRIREF and literal forms", () => {
  assert.equal(iriRef("https://example.test/a b"), "<https://example.test/a%20b>");
  assert.equal(turtleLiteral("a\nb"), '"a\\nb"');
  assert.equal(turtleLiteral(true), "true");
  assert.match(import.meta.resolve("@red-cup-engineering/turtle-services-section/turtle-term-writing"), /\/scripts\/turtle-term-writing\.mjs$/);
});
