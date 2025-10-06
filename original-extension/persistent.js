// Persistent script for BrowserProxy Extension
(function() {
    'use strict';
    
    // Keep connection alive
    var port = chrome.runtime.connect({name: 'keepAlive'});
    
    // Override common bot detection methods
    if (window.outerHeight === 0) {
        Object.defineProperty(window, 'outerHeight', {
            get: () => 1024,
        });
    }
    
    if (window.outerWidth === 0) {
        Object.defineProperty(window, 'outerWidth', {
            get: () => 1920,
        });
    }
    
    // Override screen properties
    Object.defineProperty(screen, 'availHeight', {
        get: () => 1024,
    });
    
    Object.defineProperty(screen, 'availWidth', {
        get: () => 1920,
    });
    
    // Override timezone
    const originalGetTimezoneOffset = Date.prototype.getTimezoneOffset;
    Date.prototype.getTimezoneOffset = function() {
        return -180; // UTC+3 (Moscow timezone)
    };
    
    // Override canvas fingerprinting
    const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function() {
        const context = this.getContext('2d');
        if (context) {
            context.fillStyle = 'rgba(255, 255, 255, 0.01)';
            context.fillRect(0, 0, 1, 1);
        }
        return originalToDataURL.apply(this, arguments);
    };
    
    console.log('BrowserProxy: Persistent script loaded');
})();
