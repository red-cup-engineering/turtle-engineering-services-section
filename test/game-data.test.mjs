import assert from 'node:assert/strict';
import test from 'node:test';
import { turtleSourceCodec } from '@red-cup-engineering/turtle-engineering-services-section/source-codec';

test('retains RDF term types and source identity when reading a saved score', () => {
  const bytes = new TextEncoder().encode('<urn:game> <urn:label> "Café"@fr .\n');
  const original = turtleSourceCodec.read(bytes);
  assert.deepEqual(original.value, [{s:{kind:'iri',value:'urn:game'},p:{kind:'iri',value:'urn:label'},o:{kind:'literal',value:'Café',language:'fr'}}]);
  assert.equal(original.source.ni, "ni:///sha-256;mRKsXnpgkSB4VfnzVAbQYVUi7MkUqSSr92vng0KB-Og");
  assert.equal(original.claim.object, "ni:///sha-256;KEoQKeNtu-s-f8QrmR6603krjEswSNH4Y_bEj61EzAY");
  const replay = turtleSourceCodec.write(original.value);
  assert.deepEqual(replay.reading.value, original.value);
  assert.equal(replay.reading.claim.object, original.claim.object);
  assert.deepEqual(turtleSourceCodec.read(replay.bytes), replay.reading);
  assert.throws(() => turtleSourceCodec.read(Uint8Array.of(255)));
});
