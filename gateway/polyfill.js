// DSH Remote Gen-3 gateway — browser compatibility polyfill + capability probe.
// Injected into DSH index.html <head> BEFORE app boot. Only defines missing APIs,
// so modern browsers are untouched. Reports the real UA + missing APIs back to the
// gateway (/__gate/diag) so we can verify the tablet's actual capabilities.
(function () {
  "use strict";
  var missing = [];
  function need(name, test) { try { if (!test()) { missing.push(name); return true; } } catch (e) { missing.push(name); return true; } return false; }

  // Promise.withResolvers (Chrome 119 / FF 121 / Safari 17.4)
  if (need("Promise.withResolvers", function () { return typeof Promise.withResolvers === "function"; })) {
    Promise.withResolvers = function () {
      var resolve, reject;
      var promise = new Promise(function (res, rej) { resolve = res; reject = rej; });
      return { promise: promise, resolve: resolve, reject: reject };
    };
  }

  // AbortSignal.prototype.throwIfAborted (Chrome 100 / FF 97 / Safari 15.4)
  if (typeof AbortSignal !== "undefined") {
    if (need("AbortSignal.throwIfAborted", function () { return typeof AbortSignal.prototype.throwIfAborted === "function"; })) {
      Object.defineProperty(AbortSignal.prototype, "throwIfAborted", {
        configurable: true, writable: true,
        value: function () { if (this.aborted) throw this.reason; }
      });
    }
    // AbortSignal.timeout (Chrome 103 / FF 100)
    if (need("AbortSignal.timeout", function () { return typeof AbortSignal.timeout === "function"; })) {
      AbortSignal.timeout = function (ms) {
        var c = new AbortController();
        setTimeout(function () {
          var err;
          try { err = new DOMException("signal timed out", "TimeoutError"); }
          catch (e) { err = new Error("signal timed out"); err.name = "TimeoutError"; }
          c.abort(err);
        }, ms);
        return c.signal;
      };
    }
    // AbortSignal.any (Chrome 116 / FF 124)
    if (need("AbortSignal.any", function () { return typeof AbortSignal.any === "function"; })) {
      AbortSignal.any = function (signals) {
        var c = new AbortController();
        for (var i = 0; i < signals.length; i++) {
          var s = signals[i];
          if (s.aborted) { c.abort(s.reason); return c.signal; }
          s.addEventListener("abort", function () { c.abort(this.reason); }, { once: true });
        }
        return c.signal;
      };
    }
  }

  // Object.hasOwn (Chrome 93 / FF 92 / Safari 15.4)
  if (need("Object.hasOwn", function () { return typeof Object.hasOwn === "function"; })) {
    Object.defineProperty(Object, "hasOwn", {
      configurable: true, writable: true,
      value: function (obj, key) { return Object.prototype.hasOwnProperty.call(Object(obj), key); }
    });
  }

  // Array.prototype.at / String.prototype.at (Chrome 92 / FF 90 / Safari 15.4)
  function atImpl(n) {
    n = Math.trunc(n) || 0;
    if (n < 0) n += this.length;
    if (n < 0 || n >= this.length) return undefined;
    return this[n];
  }
  if (need("Array.prototype.at", function () { return typeof Array.prototype.at === "function"; })) {
    Object.defineProperty(Array.prototype, "at", { configurable: true, writable: true, value: atImpl });
  }
  if (need("String.prototype.at", function () { return typeof String.prototype.at === "function"; })) {
    Object.defineProperty(String.prototype, "at", { configurable: true, writable: true, value: atImpl });
  }
  if (need("TypedArray.at", function () { return typeof Uint8Array.prototype.at === "function"; })) {
    try { Object.defineProperty(Object.getPrototypeOf(Uint8Array.prototype), "at", { configurable: true, writable: true, value: atImpl }); } catch (e) {}
  }

  // Array.prototype.findLast / findLastIndex (Chrome 97 / FF 104)
  if (need("Array.findLast", function () { return typeof Array.prototype.findLast === "function"; })) {
    Object.defineProperty(Array.prototype, "findLast", {
      configurable: true, writable: true,
      value: function (fn, thisArg) { for (var i = this.length - 1; i >= 0; i--) { if (fn.call(thisArg, this[i], i, this)) return this[i]; } return undefined; }
    });
    Object.defineProperty(Array.prototype, "findLastIndex", {
      configurable: true, writable: true,
      value: function (fn, thisArg) { for (var i = this.length - 1; i >= 0; i--) { if (fn.call(thisArg, this[i], i, this)) return i; } return -1; }
    });
  }

  // String.prototype.replaceAll (Chrome 85 / FF 77 / Safari 13.1)
  if (need("String.replaceAll", function () { return typeof String.prototype.replaceAll === "function"; })) {
    Object.defineProperty(String.prototype, "replaceAll", {
      configurable: true, writable: true,
      value: function (search, replacement) {
        if (search instanceof RegExp) {
          if (!search.global) throw new TypeError("replaceAll must be called with a global RegExp");
          return this.replace(search, replacement);
        }
        return this.split(String(search)).join(typeof replacement === "function" ? "" : String(replacement));
      }
    });
  }

  // structuredClone (Chrome 98 / FF 94 / Safari 15.4) — JSON fallback for plain data
  if (need("structuredClone", function () { return typeof structuredClone === "function"; })) {
    globalThis.structuredClone = function (value) { return JSON.parse(JSON.stringify(value)); };
  }

  // Change-array-by-copy (Chrome 110 / FF 115 / Safari 16) — toSorted 用于模型选择/设置排序，Chromium 97 缺失。
  if (need("Array.prototype.toSorted", function () { return typeof Array.prototype.toSorted === "function"; })) {
    Object.defineProperty(Array.prototype, "toSorted", {
      configurable: true, writable: true,
      value: function (compareFn) {
        if (compareFn !== undefined && typeof compareFn !== "function") throw new TypeError("compareFn must be a function or undefined");
        var copy = Array.from(this);
        copy.sort(compareFn);
        return copy;
      }
    });
  }
  if (need("Array.prototype.toReversed", function () { return typeof Array.prototype.toReversed === "function"; })) {
    Object.defineProperty(Array.prototype, "toReversed", { configurable: true, writable: true, value: function () { return Array.from(this).reverse(); } });
  }
  if (need("Array.prototype.toSpliced", function () { return typeof Array.prototype.toSpliced === "function"; })) {
    Object.defineProperty(Array.prototype, "toSpliced", {
      configurable: true, writable: true,
      value: function (start, deleteCount) {
        var copy = Array.from(this); var len = copy.length;
        var s = Math.trunc(start) || 0; if (s < 0) s = Math.max(len + s, 0); else s = Math.min(s, len);
        var dc = arguments.length < 2 ? len - s : Math.min(Math.max(Math.trunc(deleteCount) || 0, 0), len - s);
        var items = Array.prototype.slice.call(arguments, 2);
        copy.splice.apply(copy, [s, dc].concat(items));
        return copy;
      }
    });
  }
  if (need("Array.prototype.with", function () { return typeof Array.prototype.with === "function"; })) {
    Object.defineProperty(Array.prototype, "with", {
      configurable: true, writable: true,
      value: function (index, value) {
        var copy = Array.from(this); var i = Math.trunc(index) || 0; if (i < 0) i += copy.length;
        if (i < 0 || i >= copy.length) throw new RangeError("Invalid index");
        copy[i] = value; return copy;
      }
    });
  }

  // Capability beacon: tell the gateway what this browser actually lacked.
  try {
    var payload = JSON.stringify({
      ua: navigator.userAgent,
      missing: missing,
      href: location.href,
      hasAbortController: typeof AbortController !== "undefined",
      hasWebSocket: typeof WebSocket !== "undefined",
      ts: Date.now()
    });
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/__gate/diag", new Blob([payload], { type: "application/json" }));
    } else {
      fetch("/__gate/diag", { method: "POST", body: payload, headers: { "content-type": "application/json" }, keepalive: true }).catch(function () {});
    }
  } catch (e) {}
})();
