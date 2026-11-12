import test from "node:test";
import assert from "node:assert/strict";
import { csvCell, toCsv } from "../src/csv";
import { mk } from "./fixtures";

test("quotes fields with commas, quotes and newlines", () => {
  assert.equal(csvCell("a,b"), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell("line1\nline2"), '"line1\nline2"');
  assert.equal(csvCell("plain"), "plain");
});

test("defuses spreadsheet formulas in text but keeps negative numbers", () => {
  assert.equal(csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.equal(csvCell("+cmd"), "'+cmd");
  assert.equal(csvCell("-x"), "'-x");
  assert.equal(csvCell("@sum"), "'@sum");
  assert.equal(csvCell(-5), "-5");
  assert.equal(csvCell("a=b"), "a=b");
});

test("null, undefined and non-finite numbers are empty", () => {
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(undefined), "");
  assert.equal(csvCell(NaN), "");
  assert.equal(csvCell(Infinity), "");
});

test("toCsv emits a header and one CRLF-terminated line per process", () => {
  const out = toCsv(
    [mk(1, null, "init", { nice: null }), mk(2, 1, "a,b", { nice: -5, cmd: "=evil" })],
    [
      { key: "pid", label: "PID" },
      { key: "name", label: "Name" },
      { key: "nice", label: "Nice" },
      { key: "cmd", label: "Command" },
    ]
  );
  assert.equal(out, 'PID,Name,Nice,Command\r\n1,init,,init\r\n2,"a,b",-5,\'=evil\r\n');
});

test("toCsv with no processes is just the header", () => {
  assert.equal(toCsv([], [{ key: "pid", label: "PID" }]), "PID\r\n");
});
