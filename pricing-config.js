(function (global) {
    // Keep in sync with pricing-config.json (backend reads the same file).
    var TEST = false;

    global.AURA_PRICING = {
        testMode: TEST,
        unitPriceEur: TEST ? 0.01 : 44.99,
        bundles: TEST ? { 1: 0.01, 3: 0.03, 5: 0.05 } : { 1: 44.99, 3: 109.99, 5: 169.99 },
        testDeliveryEur: 0.01,
    };
})(window);
