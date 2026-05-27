(function injectProbe() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('inject.js');
    script.onload = function () {
        this.remove();
    };

    (document.documentElement || document.head).appendChild(script);
})();