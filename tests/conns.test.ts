import test from "node:test";
import assert from "node:assert/strict";
import { filterConns, isListening, portOf, sortConns } from "../src/conns";
import type { Connection } from "../src/types";

const c = (over: Partial<Connection>): Connection => ({
  proto: "tcp",
  local: "0.0.0.0:80",
  remote: "0.0.0.0:0",
  state: "LISTEN",
  pid: 1,
  process: "nginx",
  ...over,
});

const rows = [
  c({ local: "0.0.0.0:443", pid: 10, process: "nginx" }),
  c({ local: "127.0.0.1:5432", pid: 20, process: "postgres" }),
  c({ local: "10.0.0.2:51000", remote: "1.1.1.1:443", state: "ESTABLISHED", pid: 30, process: "curl" }),
  c({ proto: "udp", local: "0.0.0.0:68", remote: "0.0.0.0:0", state: "UNCONN", pid: null, process: null }),
  c({ proto: "tcp6", local: "[::1]:631", state: "LISTEN", pid: 40, process: "cupsd" }),
];

test("portOf handles ipv4, ipv6 and junk", () => {
  assert.equal(portOf("1.2.3.4:80"), 80);
  assert.equal(portOf("[::1]:8080"), 8080);
  assert.equal(portOf("nonsense"), -1);
  assert.equal(portOf("host:abc"), -1);
});

test("isListening covers LISTEN and UNCONN only", () => {
  assert.ok(isListening(c({ state: "LISTEN" })));
  assert.ok(isListening(c({ state: "UNCONN" })));
  assert.ok(!isListening(c({ state: "ESTABLISHED" })));
});

test("listenOnly drops established sockets", () => {
  const out = filterConns(rows, "", true);
  assert.equal(out.length, 4);
  assert.ok(out.every((r) => r.state !== "ESTABLISHED"));
  assert.equal(filterConns(rows, "", false).length, 5);
});

test("query matches process, port, pid, proto and state, and skips null owners safely", () => {
  assert.deepEqual(filterConns(rows, "postgres", false).map((r) => r.pid), [20]);
  assert.deepEqual(filterConns(rows, "5432", false).map((r) => r.pid), [20]);
  assert.deepEqual(filterConns(rows, "30", false).map((r) => r.process), ["curl"]);
  assert.deepEqual(filterConns(rows, "udp", false).map((r) => r.proto), ["udp"]);
  assert.deepEqual(filterConns(rows, "established", false).map((r) => r.pid), [30]);
  assert.equal(filterConns(rows, "zzz", false).length, 0);
});

test("sorting by local address is numeric on the port", () => {
  const out = sortConns(rows, "local", 1).map((r) => portOf(r.local));
  assert.deepEqual(out, [68, 443, 631, 5432, 51000]);
  const desc = sortConns(rows, "local", -1).map((r) => portOf(r.local));
  assert.deepEqual(desc, [51000, 5432, 631, 443, 68]);
});

test("sorting by pid puts unknown owners first ascending", () => {
  assert.deepEqual(sortConns(rows, "pid", 1).map((r) => r.pid), [null, 10, 20, 30, 40]);
});

test("sorting by process and state, and the input is not mutated", () => {
  const copy = JSON.stringify(rows);
  assert.deepEqual(sortConns(rows, "process", 1).map((r) => r.process), [null, "cupsd", "curl", "nginx", "postgres"]);
  assert.equal(sortConns(rows, "state", 1)[0].state, "ESTABLISHED");
  assert.equal(JSON.stringify(rows), copy);
});
