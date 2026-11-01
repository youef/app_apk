/* ES5 polyfills for Android 4.4 / legacy television WebViews.
   Keep loaded before the catalogue and player scripts. */
(function (w) {
  "use strict";
  if (!Object.assign) {
    Object.assign = function (target) {
      if (target === null || target === undefined) throw new TypeError("target");
      var out = Object(target), i, source, key;
      for (i = 1; i < arguments.length; i++) {
        source = arguments[i];
        if (source === null || source === undefined) continue;
        for (key in Object(source)) if (Object.prototype.hasOwnProperty.call(source, key)) out[key] = source[key];
      }
      return out;
    };
  }
  if (!String.prototype.padStart) {
    String.prototype.padStart = function (size, filler) {
      var value = String(this), fill = filler === undefined ? " " : String(filler);
      size = Math.floor(Number(size) || 0);
      if (!fill || size <= value.length) return value;
      while (fill.length < size - value.length) fill += fill;
      return fill.slice(0, size - value.length) + value;
    };
  }
  if (w.Element && !Element.prototype.matches) {
    Element.prototype.matches = Element.prototype.webkitMatchesSelector || Element.prototype.msMatchesSelector || function (selector) {
      var list = (this.document || this.ownerDocument).querySelectorAll(selector), i = list.length;
      while (--i >= 0 && list.item(i) !== this) {}
      return i >= 0;
    };
  }
  if (w.Element && !Element.prototype.closest) {
    Element.prototype.closest = function (selector) {
      var node = this;
      while (node && node.nodeType === 1) {
        if (node.matches(selector)) return node;
        node = node.parentElement;
      }
      return null;
    };
  }
  if (!w.Promise) {
    var PromisePolyfill = function (executor) {
      var self = this;
      self.state = 0; self.value = undefined; self.handlers = [];
      function settle(state, value) {
        if (self.state) return;
        self.state = state; self.value = value;
        while (self.handlers.length) dispatch(self.handlers.shift());
      }
      function resolve(value) {
        if (value === self) { reject(new TypeError("Promise cycle")); return; }
        if (value && (typeof value === "object" || typeof value === "function")) {
          var then;
          try { then = value.then; } catch (e) { reject(e); return; }
          if (typeof then === "function") {
            var called = false;
            try {
              then.call(value, function (v) { if (!called) { called = true; resolve(v); } },
                function (e) { if (!called) { called = true; reject(e); } });
            } catch (e) { if (!called) reject(e); }
            return;
          }
        }
        settle(1, value);
      }
      function reject(reason) { settle(2, reason); }
      function dispatch(handler) {
        setTimeout(function () {
          try {
            var cb = self.state === 1 ? handler.good : handler.bad;
            if (typeof cb === "function") handler.resolve(cb(self.value));
            else if (self.state === 1) handler.resolve(self.value);
            else handler.reject(self.value);
          } catch (e) { handler.reject(e); }
        }, 0);
      }
      self.then = function (good, bad) {
        return new PromisePolyfill(function (res, rej) {
          var handler = { good: good, bad: bad, resolve: res, reject: rej };
          if (!self.state) self.handlers.push(handler);
          else dispatch(handler);
        });
      };
      self["catch"] = function (bad) { return self.then(null, bad); };
      try { executor(resolve, reject); } catch (e) { reject(e); }
    };
    PromisePolyfill.resolve = function (value) { return new PromisePolyfill(function (r) { r(value); }); };
    PromisePolyfill.reject = function (reason) { return new PromisePolyfill(function (_, r) { r(reason); }); };
    PromisePolyfill.all = function (values) {
      return new PromisePolyfill(function (resolve, reject) {
        var count = values.length, results = [], i;
        if (!count) { resolve(results); return; }
        for (i = 0; i < values.length; i++) (function (index) {
          PromisePolyfill.resolve(values[index]).then(function (v) {
            results[index] = v; count--;
            if (count === 0) resolve(results);
          }, reject);
        })(i);
      });
    };
    w.Promise = PromisePolyfill;
  }
  if (!w.fetch) {
    w.fetch = function (resource, options) {
      options = options || {};
      return new w.Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest(), method = options.method || "GET";
        xhr.open(method, String(resource), true);
        var headers = options.headers || {}, key;
        for (key in headers) if (Object.prototype.hasOwnProperty.call(headers, key)) xhr.setRequestHeader(key, headers[key]);
        xhr.onreadystatechange = function () {
          if (xhr.readyState !== 4) return;
          var status = xhr.status === 1223 ? 204 : xhr.status;
          var fileSuccess = status === 0 && /^(file:|\.?\.?\/)/.test(String(resource)) && xhr.responseText.length > 0;
          var text = xhr.responseText;
          resolve({
            status: status, ok: (status >= 200 && status < 300) || fileSuccess,
            text: function () { return w.Promise.resolve(text); },
            json: function () { return new w.Promise(function (yes, no) {
              try { yes(JSON.parse(text)); } catch (e) { no(e); }
            }); }
          });
        };
        xhr.onerror = function () { reject(new Error("Network error")); };
        xhr.ontimeout = function () { reject(new Error("Network timeout")); };
        try { xhr.send(options.body || null); } catch (e) { reject(e); }
      });
    };
  }
})(window);
