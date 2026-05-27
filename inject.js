(function () {
    console.log('Performance probe injected', window.location.href);

    if (window.__uiPerformanceProbeInstalled) {
        console.log('Performance probe already installed, skipping');
        return;
    }

    window.__uiPerformanceProbeInstalled = true;

    // Core state shared by native and optional jQuery instrumentation
    const raw = [];
    const agg = {};
    const MAX_RAW_LOG_SIZE = 1000; // Cap to prevent memory growth
    const MIN_LOG_MS = 1; // Minimum ms to record a handler

    const domImpact = {};

    function trackDomImpact(type, name, elapsed, extra) {
        const key = type + ':' + name;
        if (!domImpact[key]) {
            domImpact[key] = { type, name, count: 0, total: 0, max: 0, examples: [] };
        }
        const item = domImpact[key];
        item.count++;
        item.total += elapsed;
        item.max = Math.max(item.max, elapsed);
        if (item.examples.length < 5 && extra) item.examples.push(extra);
    }

    function wrapDomPrototype(proto, methodName) {
        if (!proto || typeof proto[methodName] !== 'function') return;
        const original = proto[methodName];
        proto[methodName] = function wrappedNativeDomMethod() {
            const start = performance.now();
            try {
                return original.apply(this, arguments);
            } finally {
                trackDomImpact('native', methodName, performance.now() - start, { element: this.id || this.tagName || '(unknown)' });
            }
        };
    }

    // Native DOM wrappers
    try {
        wrapDomPrototype(Element.prototype, 'append');
        wrapDomPrototype(Element.prototype, 'prepend');
        wrapDomPrototype(Element.prototype, 'remove');
        wrapDomPrototype(Element.prototype, 'before');
        wrapDomPrototype(Element.prototype, 'after');
        wrapDomPrototype(Element.prototype, 'setAttribute');
        wrapDomPrototype(Node.prototype, 'appendChild');
        wrapDomPrototype(Node.prototype, 'removeChild');
        wrapDomPrototype(Node.prototype, 'insertBefore');
        wrapDomPrototype(Document.prototype, 'querySelector');
        wrapDomPrototype(Document.prototype, 'querySelectorAll');
        wrapDomPrototype(Element.prototype, 'querySelector');
        wrapDomPrototype(Element.prototype, 'querySelectorAll');
    } catch (e) {
        // In rare environments prototypes may be locked
        console.warn('UI Performance Probe: failed to wrap some DOM prototypes', e);
    }

    // MutationObserver
    const mutationStats = { count: 0, addedNodes: 0, removedNodes: 0, attributes: 0 };
    try {
        const observer = new MutationObserver(function (mutations) {
            mutationStats.count += mutations.length;
            mutations.forEach(function (m) {
                mutationStats.addedNodes += m.addedNodes ? m.addedNodes.length : 0;
                mutationStats.removedNodes += m.removedNodes ? m.removedNodes.length : 0;
                if (m.type === 'attributes') mutationStats.attributes++;
            });
        });
        observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    } catch (e) {
        console.warn('UI Performance Probe: MutationObserver unavailable', e);
    }

    // Exposed helpers
    window.__domImpactSummary = function domImpactSummary() {
        const rows = Object.values(domImpact)
            .map(item => ({ type: item.type, name: item.name, count: item.count, total_ms: Number(item.total.toFixed(2)), avg_ms: Number((item.total / item.count).toFixed(4)), max_ms: Number(item.max.toFixed(2)), examples: item.examples }))
            .sort((a, b) => b.total_ms - a.total_ms);
        console.table(rows);
        return rows;
    };

    window.__mutationSummary = function mutationSummary() { console.table(mutationStats); return mutationStats; };

    // PerformanceObserver longtask (best-effort)
    if (typeof PerformanceObserver === 'function') {
        try {
            new PerformanceObserver((list) => {
                list.getEntries().forEach((entry) => {
                    console.warn('LONG TASK', { duration_ms: Number(entry.duration.toFixed(2)), start_ms: Number(entry.startTime.toFixed(2)) });
                });
            }).observe({ entryTypes: ['longtask'] });
        } catch (e) {
            console.warn('UI Performance Probe: PerformanceObserver longtask unavailable', e);
        }
    }

    // Navigation & Resource timing
    window.__navigationTiming = function navigationTiming() {
        const nav = performance.getEntriesByType('navigation')[0];
        if (!nav) { console.warn('No navigation timing available'); return null; }
        const rows = {
            dns: Number((nav.domainLookupEnd - nav.domainLookupStart).toFixed(2)),
            connect: Number((nav.connectEnd - nav.connectStart).toFixed(2)),
            request: Number((nav.responseStart - nav.requestStart).toFixed(2)),
            response_download: Number((nav.responseEnd - nav.responseStart).toFixed(2)),
            dom_parse: Number((nav.domInteractive - nav.responseEnd).toFixed(2)),
            dom_ready: Number((nav.domContentLoadedEventEnd - nav.startTime).toFixed(2)),
            full_load: Number((nav.loadEventEnd - nav.startTime).toFixed(2))
        };
        console.table(rows);
        return rows;
    };

    window.__resourceTiming = function resourceTiming(limit = 30) {
        const rows = performance.getEntriesByType('resource')
            .map(r => ({ name: r.name.split('/').pop(), type: r.initiatorType, duration_ms: Number(r.duration.toFixed(2)), size: r.transferSize }))
            .sort((a, b) => b.duration_ms - a.duration_ms)
            .slice(0, limit);
        console.table(rows);
        return rows;
    };

    // Utilities used by jQuery instrumentation as well
    function ensure(name) {
        if (!agg[name]) agg[name] = { name, count: 0, total: 0, max: 0 };
        return agg[name];
    }

    function getElementLabel(el) {
        if (!el) return '(no element)';
        if (el.id) return el.id;
        const name = el.getAttribute && el.getAttribute('name');
        if (name) return `[name="${name}"]`;
        return el.tagName ? el.tagName.toLowerCase() : '(no id)';
    }

    function getStackSource(stack) {
        if (!stack) return '';
        return stack.split('\n').map(line => line.trim()).filter(line => line && line.indexOf('uiPerformanceProbe') === -1).slice(0, 3).join(' | ');
    }

    // jQuery instrumentation installer (optional)
    function installJqueryInstrumentation($) {
        if (!($ && $.fn) || window.__uiPerformanceProbeJqueryInstalled) return;
        window.__uiPerformanceProbeJqueryInstalled = true;
        try {
            // Wrap jQuery DOM methods
            function wrapJqueryMethod(methodName) {
                const original = $.fn[methodName];
                if (typeof original !== 'function') return;
                $.fn[methodName] = function wrappedJqueryDomMethod() {
                    const start = performance.now();
                    try { return original.apply(this, arguments); } finally {
                        trackDomImpact('jquery', methodName, performance.now() - start, { selector: this.selector || '', length: this.length });
                    }
                };
            }

            ['find','each','val','attr','prop','data','html','text','append','prepend','empty','show','hide','toggle','addClass','removeClass','toggleClass','css','parent','parents','children','closest','remove','detach','clone','before','after'].forEach(wrapJqueryMethod);

            // Wrap $.ajax
            if (typeof $.ajax === 'function') {
                const originalAjax = $.ajax;
                $.ajax = function () {
                    const start = performance.now();
                    const url = arguments[0]?.url || arguments[0];
                    const result = originalAjax.apply(this, arguments);
                    if (result && typeof result.always === 'function') {
                        result.always(function () { console.log('AJAX', { url, duration: (performance.now() - start).toFixed(2) }); });
                    }
                    return result;
                };
            }

            // Wrap $.fn.on
            if ($.fn && typeof $.fn.on === 'function') {
                const originalOn = $.fn.on;
                $.fn.on = function uiPerformanceProbeOverrideOn() {
                    const event = arguments[0];
                    const handler = arguments[arguments.length - 1];
                    if (typeof handler !== 'function') return originalOn.apply(this, arguments);
                    const wrapped = function uiPerformanceProbeWrappedOnHandler() {
                        const start = performance.now();
                        try { return handler.apply(this, arguments); } finally {
                            const elapsed = performance.now() - start;
                            if (elapsed < MIN_LOG_MS) return;
                            const element = getElementLabel(this);
                            const name = handler.name || `(anonymous @ ${element})`;
                            const stack = new Error().stack || '';
                            const source = getStackSource(stack);
                            if (raw.length >= MAX_RAW_LOG_SIZE) raw.shift();
                            raw.push({ name, time: Number(elapsed.toFixed(2)), element, event: String(event), source, stack });
                            const s = ensure(name);
                            s.count++; s.total += elapsed; s.max = Math.max(s.max, elapsed);
                        }
                    };
                    arguments[arguments.length - 1] = wrapped;
                    return originalOn.apply(this, arguments);
                };
            }

        } catch (e) {
            console.warn('UI Performance Probe: failed to install jQuery instrumentation', e);
        }
    }

    // Public console helpers for change handlers (exist even without jQuery)
    window.__changeHandlerTop = function changeHandlerTop(limit = 20) {
        const sorted = raw.slice().sort((a, b) => b.time - a.time).slice(0, limit).map(r => ({ name: r.name, time_ms: r.time, element: r.element, event: r.event, source: r.source }));
        console.table(sorted);
        return sorted;
    };

    window.__changeHandlerSummary = function changeHandlerSummary() {
        const rows = Object.values(agg).map(s => ({ name: s.name, count: s.count, total_ms: Number(s.total.toFixed(2)), avg_ms: Number((s.total / s.count).toFixed(2)), max_ms: Number(s.max.toFixed(2)) })).sort((a, b) => b.total_ms - a.total_ms);
        console.table(rows);
        return rows;
    };

    window.__changeHandlerRaw = function changeHandlerRaw() { console.table(raw); return raw; };

    window.__changeHandlerFor = function changeHandlerFor(elementId) {
        const rows = raw.filter(r => r.element === elementId || (r.name && r.name.indexOf(elementId) !== -1)).sort((a, b) => b.time - a.time).map(r => ({ name: r.name, time_ms: r.time, element: r.element, event: r.event, source: r.source }));
        console.table(rows); return rows;
    };

    // Auto report
    setTimeout(function uiPerformanceProbeAutoConsoleReport() {
        console.log('🔍 Top slow change executions:'); window.__changeHandlerTop();
        console.log('📊 Aggregated change handler stats:'); window.__changeHandlerSummary();
        console.log('🧱 DOM impact summary:'); window.__domImpactSummary();
        console.log('🧬 Mutation summary:'); window.__mutationSummary();
        console.log('🌐 Navigation timing:'); window.__navigationTiming();
        console.log('📦 Resource timing:'); window.__resourceTiming();
    }, 8000);

    // Try to install jQuery instrumentation if present; otherwise continue
    if (window.jQuery) {
        installJqueryInstrumentation(window.jQuery);
    } else {
        console.info('UI Performance Probe: jQuery not detected; continuing with native JS instrumentation.');
        // Optional limited retry for jQuery detection (tries every 1s up to 30s)
        let jqAttempts = 0; const jqMax = 30;
        const jqInterval = setInterval(() => {
            jqAttempts++;
            if (window.jQuery) { installJqueryInstrumentation(window.jQuery); clearInterval(jqInterval); }
            else if (jqAttempts >= jqMax) clearInterval(jqInterval);
        }, 1000);
    }

})();
