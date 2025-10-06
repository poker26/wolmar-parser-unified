// Background script for BrowserProxy Chrome Extension
const SERVER_URL = 'http://localhost:5000';

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetchUrl') {
    fetchUrl(request.url)
      .then(html => sendResponse({ success: true, html }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep message channel open for async response
  }
});

// Function to fetch URL through the extension
async function fetchUrl(url) {
  try {
    // Navigate to the URL in a new tab
    const tab = await chrome.tabs.create({ url: url, active: false });
    
    // Wait for page to load
    await waitForPageLoad(tab.id);
    
    // Get page HTML
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: () => document.documentElement.outerHTML
    });
    
    // Close the tab
    await chrome.tabs.remove(tab.id);
    
    return results[0].result;
  } catch (error) {
    throw new Error(`Failed to fetch URL: ${error.message}`);
  }
}

// Wait for page to load completely
function waitForPageLoad(tabId) {
  return new Promise((resolve) => {
    const checkComplete = () => {
      chrome.tabs.get(tabId, (tab) => {
        if (tab.status === 'complete') {
          // Additional wait for dynamic content
          setTimeout(resolve, 2000);
        } else {
          setTimeout(checkComplete, 500);
        }
      });
    };
    checkComplete();
  });
}