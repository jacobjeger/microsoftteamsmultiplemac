import React, { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';

let tabIdCounter = 0;

export default function App() {
  const [tabs, setTabs] = useState([]);
  const [activeTabId, setActiveTabId] = useState(null);
  const [addressValue, setAddressValue] = useState('');
  const webviewRefs = useRef({});
  const { partition, accountName } = window.api.getQueryParams();

  useEffect(() => {
    window.api.onAddTab((url) => {
      addTab(url);
    });
  }, []);

  // Update address bar when active tab changes
  useEffect(() => {
    const tab = tabs.find(t => t.id === activeTabId);
    if (tab) setAddressValue(tab.url);
  }, [activeTabId, tabs]);

  const addTab = useCallback((url = 'about:blank') => {
    const id = ++tabIdCounter;
    setTabs(prev => [...prev, { id, url, title: 'Loading...' }]);
    setActiveTabId(id);
  }, []);

  const closeTab = useCallback((id) => {
    setTabs(prev => {
      const next = prev.filter(t => t.id !== id);
      if (id === activeTabId && next.length > 0) {
        const idx = prev.findIndex(t => t.id === id);
        const newIdx = Math.min(idx, next.length - 1);
        setActiveTabId(next[newIdx].id);
      }
      if (next.length === 0) setActiveTabId(null);
      return next;
    });
    delete webviewRefs.current[id];
  }, [activeTabId]);

  const navigate = (url) => {
    if (!activeTabId) return;
    let finalUrl = url;
    if (!/^https?:\/\//i.test(finalUrl) && !/^about:/i.test(finalUrl)) {
      if (finalUrl.includes('.') && !finalUrl.includes(' ')) {
        finalUrl = 'https://' + finalUrl;
      } else {
        finalUrl = 'https://www.google.com/search?q=' + encodeURIComponent(finalUrl);
      }
    }
    const wv = webviewRefs.current[activeTabId];
    if (wv) wv.loadURL(finalUrl);
  };

  const goBack = () => {
    const wv = webviewRefs.current[activeTabId];
    if (wv && wv.canGoBack()) wv.goBack();
  };

  const goForward = () => {
    const wv = webviewRefs.current[activeTabId];
    if (wv && wv.canGoForward()) wv.goForward();
  };

  const reload = () => {
    const wv = webviewRefs.current[activeTabId];
    if (wv) wv.reload();
  };

  const handleWebviewReady = (tabId, webview) => {
    if (!webview || webviewRefs.current[tabId]) return;
    webviewRefs.current[tabId] = webview;

    webview.addEventListener('page-title-updated', (e) => {
      setTabs(prev => prev.map(t => t.id === tabId ? { ...t, title: e.title } : t));
    });

    webview.addEventListener('did-navigate', (e) => {
      setTabs(prev => prev.map(t => t.id === tabId ? { ...t, url: e.url } : t));
      if (tabId === activeTabId) setAddressValue(e.url);
    });

    webview.addEventListener('did-navigate-in-page', (e) => {
      if (e.isMainFrame) {
        setTabs(prev => prev.map(t => t.id === tabId ? { ...t, url: e.url } : t));
        if (tabId === activeTabId) setAddressValue(e.url);
      }
    });

    // Intercept new window requests → open as new tab
    webview.addEventListener('new-window', (e) => {
      e.preventDefault();
      if (e.url && e.url !== 'about:blank') {
        addTab(e.url);
      }
    });
  };

  return (
    <div className="browser-app">
      <div className="tab-bar">
        {tabs.map(tab => (
          <div
            key={tab.id}
            className={`tab ${tab.id === activeTabId ? 'active' : ''}`}
            onClick={() => setActiveTabId(tab.id)}
          >
            <span className="tab-title">{tab.title || 'New Tab'}</span>
            <button className="tab-close" onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}>x</button>
          </div>
        ))}
        <button className="tab-new" onClick={() => addTab()}>+</button>
      </div>

      <div className="address-bar">
        <button className="nav-btn" onClick={goBack} title="Back">&#8592;</button>
        <button className="nav-btn" onClick={goForward} title="Forward">&#8594;</button>
        <button className="nav-btn" onClick={reload} title="Reload">&#8635;</button>
        <input
          type="text"
          className="address-input"
          value={addressValue}
          onChange={(e) => setAddressValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') navigate(addressValue);
          }}
          placeholder="Enter URL..."
        />
      </div>

      <div className="webview-container">
        {tabs.map(tab => (
          <webview
            key={tab.id}
            ref={(el) => {
              if (el) handleWebviewReady(tab.id, el);
            }}
            src={tab.url}
            partition={partition}
            className={`webview ${tab.id === activeTabId ? 'visible' : ''}`}
            allowpopups="true"
          />
        ))}
        {tabs.length === 0 && (
          <div className="empty-browser">
            <p>{accountName} Browser</p>
            <p className="empty-hint">Links from Teams will open here</p>
          </div>
        )}
      </div>
    </div>
  );
}
