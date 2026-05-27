console.log('Performance probe injected', window.location.href);

// Guard against double injection
if (window.__uiPerformanceProbeInstalled) {
    console.log('Performance probe already installed, skipping');
    return;
}

(function waitForJQuery() {
    let attempts = 0;
    const maxAttempts = 300; // ~30 seconds at 100ms intervals

    function tryLoad() {
        attempts++;

        if (!window.jQuery || !window.jQuery.fn || !window.jQuery.fn.on) {
            if (attempts < maxAttempts) {
                setTimeout(tryLoad, 100);
            } else {
                console.warn('Performance probe: jQuery not loaded within 30 seconds, giving up');
            }
            return;
        }

        injectProbe(window.jQuery);
    }

    function injectProbe($) {
        if (window.__uiPerformanceProbeInstalled) {
            return;
        }

        window.__uiPerformanceProbeInstalled = true;

        (function uiPerformanceProbeIIFE($) {
            const raw = [];
            const agg = {};
            const MAX_RAW_LOG_SIZE = 1000; // Cap to prevent memory growth
            const MIN_LOG_MS = 1; // raise to 5 if you only want meaningful slow calls

        const domImpact = {};

        /**
         * Records performance metrics for a DOM operation.
         * Aggregates execution time and maintains up to 5 example calls.
         * @param {string} type - Category: 'jquery' or 'native'
         * @param {string} name - Method name (e.g., 'append', 'querySelector')
         * @param {number} elapsed - Execution time in milliseconds
         * @param {Object} extra - Additional context (selector, element, etc.)
         */
        function trackDomImpact(type, name, elapsed, extra) {
            const key = type + ':' + name;

            if (!domImpact[key]) {
                domImpact[key] = {
                    type,
                    name,
                    count: 0,
                    total: 0,
                    max: 0,
                    examples: []
                };
            }

            const item = domImpact[key];

            item.count++;
            item.total += elapsed;
            item.max = Math.max(item.max, elapsed);

            if (item.examples.length < 5 && extra) {
                item.examples.push(extra);
            }
        }

        /**
         * Wraps a jQuery prototype method to measure execution time.
         * Preserves original behavior, return values, and error handling.
         * @param {string} methodName - jQuery method to instrument (e.g., 'append', 'find')
         */
        function wrapJqueryMethod(methodName) {
            const original = $.fn[methodName];

            if (typeof original !== 'function') return;

            $.fn[methodName] = function wrappedJqueryDomMethod() {
                const start = performance.now();

                try {
                    return original.apply(this, arguments);
                } finally {
                    trackDomImpact(
                        'jquery',
                        methodName,
                        performance.now() - start,
                        {
                            selector: this.selector || '',
                            length: this.length
                        }
                    );
                }
            };
        }

        [
            'find',
            'each',
            'val',
            'attr',
            'prop',
            'data',
            'html',
            'text',
            'append',
            'prepend',
            'empty',
            'show',
            'hide',
            'toggle',
            'addClass',
            'removeClass',
            'toggleClass',
            'css',
            'parent',
            'parents',
            'children',
            'closest',
            'remove',
            'detach',
            'clone',
            'before',
            'after'
        ].forEach(wrapJqueryMethod);

        /**
         * Wraps a native DOM method on a prototype to measure execution time.
         * Used for Element, Node, and Document API methods.
         * @param {Object} proto - Prototype to wrap (e.g., Element.prototype, Document.prototype)
         * @param {string} methodName - Method name to instrument (e.g., 'appendChild', 'querySelector')
         */
        function wrapDomPrototype(proto, methodName) {
            if (!proto || typeof proto[methodName] !== 'function') return;

            const original = proto[methodName];

            proto[methodName] = function wrappedNativeDomMethod() {
                const start = performance.now();

                try {
                    return original.apply(this, arguments);
                } finally {
                    trackDomImpact(
                        'native',
                        methodName,
                        performance.now() - start,
                        {
                            element: this.id || this.tagName || '(unknown)'
                        }
                    );
                }
            };
        }

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

        const mutationStats = {
            count: 0,
            addedNodes: 0,
            removedNodes: 0,
            attributes: 0
        };

        const observer = new MutationObserver(function (mutations) {
            mutationStats.count += mutations.length;

            mutations.forEach(function (m) {
                mutationStats.addedNodes += m.addedNodes ? m.addedNodes.length : 0;
                mutationStats.removedNodes += m.removedNodes ? m.removedNodes.length : 0;

                if (m.type === 'attributes') {
                    mutationStats.attributes++;
                }
            });
        });

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true
        });

        /**
         * Aggregated statistics for jQuery and native DOM method calls.
         * Shows count, total time, average, max, and example calls per method.
         * @returns {Array<Object>} Array of {type, name, count, total_ms, avg_ms, max_ms, examples} sorted by total time
         */
        window.__domImpactSummary = function domImpactSummary() {
            const rows = Object.values(domImpact)
                .map(item => ({
                    type: item.type,
                    name: item.name,
                    count: item.count,
                    total_ms: Number(item.total.toFixed(2)),
                    avg_ms: Number((item.total / item.count).toFixed(4)),
                    max_ms: Number(item.max.toFixed(2)),
                    examples: item.examples
                }))
                .sort((a, b) => b.total_ms - a.total_ms);

            console.table(rows);
            return rows;
        };

        /**
         * DOM mutation statistics collected by MutationObserver.
         * Reports total mutations and node changes since page load.
         * @returns {Object} {count, addedNodes, removedNodes, attributes}
         */
        window.__mutationSummary = function mutationSummary() {
            console.table(mutationStats);
            return mutationStats;
        };

        new PerformanceObserver((list) => {
            list.getEntries().forEach((entry) => {
                console.warn('LONG TASK', {
                    duration_ms: Number(entry.duration.toFixed(2)),
                    start_ms: Number(entry.startTime.toFixed(2))
                });
            });
        }).observe({ entryTypes: ['longtask'] });

        const originalAjax = $.ajax;

        $.ajax = function () {
            const start = performance.now();
            const url = arguments[0]?.url || arguments[0];

            const result = originalAjax.apply(this, arguments);

            result.always(function () {
                console.log('AJAX', {
                    url,
                    duration: (performance.now() - start).toFixed(2)
                });
            });

            return result;
        };

        /**
         * Ensures an aggregation entry exists for a handler name.
         * Creates entry with zero counts if it doesn't exist.
         * @param {string} name - Handler function name or identifier
         * @returns {Object} Aggregation object with count, total, max properties
         */
        function ensure(name) {
            if (!agg[name]) {
                agg[name] = {
                    name,
                    count: 0,
                    total: 0,
                    max: 0
                };
            }

            return agg[name];
        }

        /**
         * Generates a human-readable label for an element.
         * Prefers id > name attribute > tagName.
         * @param {Element} el - DOM element to label
         * @returns {string} Element identifier or descriptor
         */
        function getElementLabel(el) {
            if (!el) return '(no element)';

            if (el.id) return el.id;

            const name = el.getAttribute && el.getAttribute('name');
            if (name) return `[name="${name}"]`;

            return el.tagName ? el.tagName.toLowerCase() : '(no id)';
        }

        /**
         * Extracts meaningful stack trace lines, filtering out probe internals.
         * Returns first 3 non-probe lines as a pipe-delimited string.
         * @param {string} stack - Error stack trace
         * @returns {string} Cleaned stack source for debugging
         */
        function getStackSource(stack) {
            if (!stack) return '';

            return stack
                .split('\n')
                .map(line => line.trim())
                .filter(line =>
                    line &&
                    line.indexOf('uiPerformanceProbeWrappedOnHandler') === -1 &&
                    line.indexOf('uiPerformanceProbeOverrideOn') === -1 &&
                    line.indexOf('getStackSource') === -1
                )
                .slice(0, 3)
                .join(' | ');
        }

        const originalOn = $.fn.on;

        $.fn.on = function uiPerformanceProbeOverrideOn() {
            const event = arguments[0];
            const handler = arguments[arguments.length - 1];

            if (typeof handler !== 'function') {
                return originalOn.apply(this, arguments);
            }

            const wrapped = function uiPerformanceProbeWrappedOnHandler() {
                const start = performance.now();

                try {
                    return handler.apply(this, arguments);
                } finally {
                    const elapsed = performance.now() - start;

                    // if (String(event).indexOf('change') === -1) {
                    //     return;
                    // }

                    if (elapsed < MIN_LOG_MS) {
                        return;
                    }

                    const element = getElementLabel(this);
                    const name = handler.name || `(anonymous @ ${element})`;
                    const stack = new Error().stack || '';
                    const source = getStackSource(stack);

                    // Cap raw logs to prevent unbounded memory growth
                    if (raw.length >= MAX_RAW_LOG_SIZE) {
                        raw.shift();
                    }

                    raw.push({
                        name,
                        time: Number(elapsed.toFixed(2)),
                        element,
                        event: String(event),
                        source,
                        stack
                    });

                    const s = ensure(name);
                    s.count++;
                    s.total += elapsed;
                    s.max = Math.max(s.max, elapsed);
                }
            };

            arguments[arguments.length - 1] = wrapped;
            return originalOn.apply(this, arguments);
        };

        /**
         * Returns the top N slowest event handler executions.
         * Useful for identifying performance bottlenecks in real-time.
         * @param {number} [limit=20] - Maximum number of results to return
         * @returns {Array<Object>} Array of {name, time_ms, element, event, source} sorted by time descending
         */
        window.__changeHandlerTop = function changeHandlerTop(limit = 20) {
            const sorted = raw
                .slice()
                .sort((a, b) => b.time - a.time)
                .slice(0, limit)
                .map(r => ({
                    name: r.name,
                    time_ms: r.time,
                    element: r.element,
                    event: r.event,
                    source: r.source
                }));

            console.table(sorted);
            return sorted;
        };

        /**
         * Aggregated statistics for all event handler executions.
         * Groups by handler name and shows execution count, total, average, and max time.
         * @returns {Array<Object>} Array of {name, count, total_ms, avg_ms, max_ms} sorted by total time descending
         */
        window.__changeHandlerSummary = function changeHandlerSummary() {
            const rows = Object.values(agg)
                .map(s => ({
                    name: s.name,
                    count: s.count,
                    total_ms: Number(s.total.toFixed(2)),
                    avg_ms: Number((s.total / s.count).toFixed(2)),
                    max_ms: Number(s.max.toFixed(2))
                }))
                .sort((a, b) => b.total_ms - a.total_ms);

            console.table(rows);
            return rows;
        };

        /**
         * Raw, unprocessed event handler execution log.
         * Contains all individual executions (up to 1000 most recent).
         * Useful for detailed debugging and stack trace inspection.
         * @returns {Array<Object>} Array of {name, time, element, event, source, stack}
         */
        window.__changeHandlerRaw = function changeHandlerRaw() {
            console.table(raw);
            return raw;
        };

        /**
         * Filters event handler executions by element ID or handler name.
         * Useful for investigating a specific UI component's performance.
         * @param {string} elementId - Element ID, name attribute, or handler name fragment to filter by
         * @returns {Array<Object>} Matching executions sorted by time descending
         */
        window.__changeHandlerFor = function changeHandlerFor(elementId) {
            const rows = raw
                .filter(r => r.element === elementId || r.name.indexOf(elementId) !== -1)
                .sort((a, b) => b.time - a.time)
                .map(r => ({
                    name: r.name,
                    time_ms: r.time,
                    element: r.element,
                    event: r.event,
                    source: r.source
                }));

            console.table(rows);
            return rows;
        };

        /**
         * Page load performance breakdown from the Navigation Timing API.
         * Measures DNS, connect, request, response, DOM parsing, and full load times.
         * @returns {Object|null} {dns, connect, request, response_download, dom_parse, dom_ready, full_load} or null if unavailable
         */
        window.__navigationTiming = function navigationTiming() {
            const nav = performance.getEntriesByType('navigation')[0];

            if (!nav) {
                console.warn('No navigation timing available');
                return null;
            }

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

        /**
         * Slowest resources loaded on the page (scripts, stylesheets, images, etc.).
         * Sorted by duration descending.
         * @param {number} [limit=30] - Maximum number of resources to return
         * @returns {Array<Object>} Array of {name, type, duration_ms, size} for slowest resources
         */
        window.__resourceTiming = function resourceTiming(limit = 30) {
            const rows = performance.getEntriesByType('resource')
                .map(r => ({
                    name: r.name.split('/').pop(),
                    type: r.initiatorType,
                    duration_ms: Number(r.duration.toFixed(2)),
                    size: r.transferSize
                }))
                .sort((a, b) => b.duration_ms - a.duration_ms)
                .slice(0, limit);

            console.table(rows);
            return rows;
        };

        setTimeout(function uiPerformanceProbeAutoConsoleReport() {
            console.log('🔍 Top slow change executions:');
            window.__changeHandlerTop();

            console.log('📊 Aggregated change handler stats:');
            window.__changeHandlerSummary();

            console.log('🧱 DOM impact summary:');
            window.__domImpactSummary();

            console.log('🧬 Mutation summary:');
            window.__mutationSummary();

            console.log('🌐 Navigation timing:');
            window.__navigationTiming();

            console.log('📦 Resource timing:');
            window.__resourceTiming();
        }, 8000);

        })(window.jQuery);
    }

    tryLoad();
})();