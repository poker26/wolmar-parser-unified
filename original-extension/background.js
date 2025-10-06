(async function () {
    var nextUrlApiAction = 'http://localhost:5000/task';
    var resultApiAction = 'http://localhost:5000/result';
    var tabsOpenedByExtensionIds = new Set();
    var timeoutMs = 20000;
    var maxExtensionTabs = 4;
    var mainLoopIntervalMs = 2000;
    var defaultWaitSelectors = [
        '#id_captcha_frame_div',
        '.botsPriceLink',
        '#challenge-running',
        '#challenge',
        '#challenge-error-text'];
    var defaultClickSelectors = [
        '#otv3_submit',
        '#otv3 .button__orange:visible'];
    var tabInfos = {};
    
    async function handleTick(){
        await ensureTabsOpen();
        await handleOpenTabs();
        await handleQueue();
    }
    
    async function ensureTabsOpen(){
        await ensurePersistentTabOpen();
        var tabs = await getAvailableTabs();
        for (var i = tabs.length; i < maxExtensionTabs; i++){
            var tab = await chrome.tabs.create({ 
                url: 'about:blank', 
                active: false 
            });
            tabsOpenedByExtensionIds.add(tab.id);
        }
    }
    
    async function ensurePersistentTabOpen(){
        var url = chrome.runtime.getURL("persistent.html")
        var tabs = await chrome.tabs.query({});
        var persistentTab = tabs.find(t => t.url == url);
        if (!persistentTab){
            persistentTab = await chrome.tabs.create({ 
                url: url, 
                active: false 
            });
        }
        return persistentTab;
    }
    
    function handleConnection(port){
        if (port.name === 'keepAlive') {
            setTimeout(() => port.disconnect(), 250e3);
            port.onDisconnect.addListener(ensurePersistentTabOpen);
        }
    }
    
    chrome.runtime.onConnect.addListener(handleConnection);
    setInterval(handleTick, mainLoopIntervalMs);
    
})();