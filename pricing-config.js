(function (global) {
    // Keep in sync with pricing-config.json (backend reads the same file).
    var TEST = true;

    global.AURA_PRICING = {
        testMode: TEST,
        unitPriceEur: TEST ? 0.01 : 59,
        bundles: TEST ? { 1: 0.01, 3: 0.03, 5: 0.05 } : { 1: 59, 3: 159, 5: 249 },
        testDeliveryEur: 0.01,
    };
})(window);
