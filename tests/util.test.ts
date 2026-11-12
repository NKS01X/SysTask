import test from "node:test";
import assert from "node:assert/strict";
import { HISTORY, fmtBytes, fmtCpuTime, fmtRate, fmtUptime, level, pct, push } from "../src/util";

test("fmtBytes scales units", () => {
  assert.equal(fmtBytes(0), "0 B");
  assert.equal(fmtBytes(1023), "1023 B");
  assert.equal(fmtBytes(1024), "1.0 KB");
  assert.equal(fmtBytes(1536), "1.5 KB");
  assert.equal(fmtBytes(5 * 1024 ** 3), "5.0 GB");
  assert.equal(fmtBytes(1024 ** 5), "1024.0 TB");
  assert.equal(fmtRate(2048), "2.0 KB/s");
});

test("fmtUptime", () => {
  assert.equal(fmtUptime(59), "0h 0m");
  assert.equal(fmtUptime(3 * 3600 + 5 * 60), "3h 5m");
  assert.equal(fmtUptime(2 * 86400 + 3600), "2d 1h 0m");
});

test("fmtCpuTime", () => {
  assert.equal(fmtCpuTime(0), "0:00.00");
  assert.equal(fmtCpuTime(5.5), "0:05.50");
  assert.equal(fmtCpuTime(65.25), "1:05.25");
  assert.equal(fmtCpuTime(3600), "1:00:00");
  assert.equal(fmtCpuTime(3725.9), "1:02:05");
  assert.equal(fmtCpuTime(-3), "0:00.00");
  assert.equal(fmtCpuTime(NaN), "0:00.00");
});

test("level thresholds", () => {
  assert.equal(level(0), "ok");
  assert.equal(level(59.9), "ok");
  assert.equal(level(60), "warn");
  assert.equal(level(85), "hot");
});

test("push caps history length and keeps the newest values", () => {
  let a: number[] = [];
  for (let i = 0; i < HISTORY + 5; i++) a = push(a, i);
  assert.equal(a.length, HISTORY);
  assert.equal(a[a.length - 1], HISTORY + 4);
  assert.equal(a[0], 5);
});

test("pct clamps and guards zero totals", () => {
  assert.equal(pct(50, 200), 25);
  assert.equal(pct(5, 0), 0);
  assert.equal(pct(300, 200), 100);
  assert.equal(pct(-5, 200), 0);
  assert.equal(pct(NaN, 200), 0);
});
