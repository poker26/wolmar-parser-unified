// Persistent script for maintaining connection (from Habr article)
(function connect() {
    chrome.runtime.connect({name: 'keepAlive'})
        .onDisconnect.addListener(connect);
})();
