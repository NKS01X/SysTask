import test from "node:test";
import assert from "node:assert/strict";
import { edgeSelection, stepSelection } from "../src/nav";

const P = [10, 20, 30, 40];

test("moves and clamps at both ends", () => {
  assert.equal(stepSelection(P, 20, 1), 30);
  assert.equal(stepSelection(P, 20, -1), 10);
  assert.equal(stepSelection(P, 10, -1), 10);
  assert.equal(stepSelection(P, 40, 1), 40);
  assert.equal(stepSelection(P, 20, 10), 40);
  assert.equal(stepSelection(P, 30, -10), 10);
});

test("nothing selected: down picks first, up picks last", () => {
  assert.equal(stepSelection(P, null, 1), 10);
  assert.equal(stepSelection(P, null, -1), 40);
});

test("selection that was filtered out behaves like no selection", () => {
  assert.equal(stepSelection(P, 99, 1), 10);
  assert.equal(stepSelection(P, 99, -1), 40);
});

test("empty list yields null", () => {
  assert.equal(stepSelection([], 5, 1), null);
  assert.equal(edgeSelection([], "start"), null);
});

test("edges", () => {
  assert.equal(edgeSelection(P, "start"), 10);
  assert.equal(edgeSelection(P, "end"), 40);
});
