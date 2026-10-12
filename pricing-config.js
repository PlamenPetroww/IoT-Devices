(function (global) {
    // Keep in sync with pricing-config.json (backend reads the same file).
    var TEST = false;

    global.AURA_PRICING = {
        testMode: TEST,
        unitPriceEur: TEST ? 0.01 : 59,
        bundles: TEST ? { 1: 0.01, 3: 0.03, 5: 0.05 } : { 1: 59, 3: 159, 5: 249 },
        kitRules: TEST
            ? {
                  maxSirens: 3,
                  sirenUnitEur: [0.01, 0.01, 0.01],
                  bundleDiscountEur: { 1: 0, 3: 0, 5: 0 },
              }
            : {
                  maxSirens: 3,
                  sirenUnitEur: [94, 79, 69],
                  bundleDiscountEur: { 1: 4, 3: 24, 5: 44 },
              },
        testDeliveryEur: 0.01,
    };
})(window);
