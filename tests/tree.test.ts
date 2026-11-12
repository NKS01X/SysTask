import test from "node:test";
import assert from "node:assert/strict";
import { buildRows, type BuildOpts } from "../src/tree";
import { mk } from "./fixtures";

const base: BuildOpts = {
  query: "",
  mineOnly: false,
  me: "me",
  sortKey: "pid",
  sortDir: "asc",
  tree: false,
  collapsed: new Set(),
};
const pids = (rows: ReturnType<typeof buildRows>) => rows.map((r) => r.p.pid);

const procs = [
  mk(1, null, "init", { user: "root", cpu: 1 }),
  mk(10, 1, "bash", { cpu: 5 }),
  mk(11, 10, "vim", { cpu: 20 }),
  mk(12, 10, "make", { cpu: 90, user: "root" }),
  mk(20, 1, "sshd", { user: "root", cpu: 2 }),
];

test("flat: sorts numerically in both directions, ties by pid", () => {
  assert.deepEqual(pids(buildRows(procs, { ...base, sortKey: "cpu", sortDir: "desc" })), [12, 11, 10, 20, 1]);
  assert.deepEqual(pids(buildRows(procs, { ...base, sortKey: "cpu", sortDir: "asc" })), [1, 20, 10, 11, 12]);
  const tie = [mk(5, null, "a"), mk(3, null, "b")];
  assert.deepEqual(pids(buildRows(tie, { ...base, sortKey: "cpu", sortDir: "desc" })), [3, 5]);
});

test("flat: sorts text columns", () => {
  assert.deepEqual(pids(buildRows(procs, { ...base, sortKey: "name" })), [10, 1, 12, 20, 11]);
});

test("new numeric columns sort, with missing values last when descending", () => {
  const p = [
    mk(1, null, "a", { io_read_bps: null }),
    mk(2, null, "b", { io_read_bps: 500 }),
    mk(3, null, "c", { io_read_bps: 10 }),
  ];
  assert.deepEqual(pids(buildRows(p, { ...base, sortKey: "io_read_bps", sortDir: "desc" })), [2, 3, 1]);
  const t = [mk(1, null, "a", { threads: 4 }), mk(2, null, "b", { threads: 40 })];
  assert.deepEqual(pids(buildRows(t, { ...base, sortKey: "threads", sortDir: "desc" })), [2, 1]);
});

test("search matches name, user, command and pid, case-insensitively", () => {
  assert.deepEqual(pids(buildRows(procs, { ...base, query: "VIM" })), [11]);
  assert.deepEqual(pids(buildRows(procs, { ...base, query: "root" })), [1, 12, 20]);
  assert.deepEqual(pids(buildRows(procs, { ...base, query: "12" })), [12]);
  assert.deepEqual(pids(buildRows(procs, { ...base, query: "  sshd " })), [20]);
  assert.deepEqual(pids(buildRows(procs, { ...base, query: "nomatch" })), []);
});

test("mineOnly filters by user", () => {
  assert.deepEqual(pids(buildRows(procs, { ...base, mineOnly: true })), [10, 11]);
});

test("tree: depth-first order with depths and child flags", () => {
  const rows = buildRows(procs, { ...base, tree: true });
  assert.deepEqual(pids(rows), [1, 10, 11, 12, 20]);
  assert.deepEqual(rows.map((r) => r.depth), [0, 1, 2, 2, 1]);
  assert.deepEqual(rows.map((r) => r.hasChildren), [true, true, false, false, false]);
});

test("tree: collapsed nodes hide their subtree", () => {
  const rows = buildRows(procs, { ...base, tree: true, collapsed: new Set([10]) });
  assert.deepEqual(pids(rows), [1, 10, 20]);
  assert.equal(rows[1].expanded, false);
});

test("tree: searching keeps ancestors and force-expands", () => {
  const rows = buildRows(procs, { ...base, tree: true, query: "vim", collapsed: new Set([1, 10]) });
  assert.deepEqual(pids(rows), [1, 10, 11]);
  assert.ok(rows.every((r) => r.expanded || !r.hasChildren));
});

test("tree: a process whose parent is missing becomes a root", () => {
  const orphan = [mk(50, 999, "orphan"), mk(51, 50, "child")];
  assert.deepEqual(pids(buildRows(orphan, { ...base, tree: true })), [50, 51]);
});

test("tree: self-parent and parent cycles do not loop forever", () => {
  const self = [mk(7, 7, "selfie")];
  assert.deepEqual(pids(buildRows(self, { ...base, tree: true })), [7]);
  const cyc = [mk(1, 2, "a"), mk(2, 1, "b")];
  // Both are someone's child, so neither is a root; they are simply not shown, but it terminates.
  assert.deepEqual(pids(buildRows(cyc, { ...base, tree: true })), []);
});
