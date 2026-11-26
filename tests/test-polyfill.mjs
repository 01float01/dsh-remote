import fs from "node:fs";
import assert from "node:assert";
const code = fs.readFileSync(new URL("../gateway/polyfill.js", import.meta.url), "utf8");
// Simulate an old browser lacking these APIs (the tablet's condition).
delete AbortSignal.prototype.throwIfAborted;
delete Object.hasOwn;
delete Array.prototype.at;
delete String.prototype.at;
delete Promise.withResolvers;
delete Array.prototype.findLast;
delete String.prototype.replaceAll;
assert.strictEqual(typeof AbortSignal.prototype.throwIfAborted, "undefined", "pre: throwIfAborted removed");
assert.strictEqual(typeof Promise.withResolvers, "undefined", "pre: withResolvers removed");
// Run the injected polyfill in global scope.
(0, eval)(code);
assert.strictEqual(typeof AbortSignal.prototype.throwIfAborted, "function", "post: throwIfAborted restored");
assert.strictEqual(typeof Promise.withResolvers, "function", "post: withResolvers restored");
assert.strictEqual(typeof Object.hasOwn, "function", "post: Object.hasOwn restored");
assert.strictEqual(typeof Array.prototype.at, "function", "post: Array.at restored");
assert.strictEqual(typeof String.prototype.replaceAll, "function", "post: replaceAll restored");
// Functional checks.
const c = new AbortController();
c.abort(new Error("aborted-reason"));
let threw = false;
try { c.signal.throwIfAborted(); } catch (e) { threw = true; assert.strictEqual(e.message, "aborted-reason"); }
assert.ok(threw, "throwIfAborted throws on aborted signal");
const ok = new AbortController();
ok.signal.throwIfAborted(); // not aborted -> no throw
const wr = Promise.withResolvers();
wr.resolve(42);
assert.strictEqual(await wr.promise, 42, "withResolvers works");
assert.strictEqual([1, 2, 3].at(-1), 3, "Array.at(-1)");
assert.strictEqual("abc".at(-1), "c", "String.at(-1)");
assert.ok(Object.hasOwn({ a: 1 }, "a"), "Object.hasOwn");
assert.strictEqual("a-b-c".replaceAll("-", "+"), "a+b+c", "replaceAll");
assert.strictEqual([1, 2, 3].findLast(x => x < 3), 2, "findLast");
console.log("POLYFILL UNIT TEST: ALL PASS (simulated old browser -> APIs restored & functional)");
