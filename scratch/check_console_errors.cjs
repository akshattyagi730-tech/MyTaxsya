const { chromium } = require('playwright');

(async () => {
  try {
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
    console.log('Connected to browser over CDP!');
    const contexts = browser.contexts();
    if (contexts.length === 0) {
      console.log('No contexts found.');
      await browser.close();
      return;
    }
    const pages = contexts[0].pages();
    console.log('Currently open pages:', pages.map(p => p.url()));
    
    // Find the localhost:5175 page
    const page = pages.find(p => p.url().includes('localhost:5175'));
    if (!page) {
      console.log('Could not find open page containing "localhost:5175"');
      await browser.close();
      return;
    }
    
    console.log(`Found page: ${page.url()}. Listening for console logs and errors...`);
    
    page.on('console', msg => {
      console.log(`[CONSOLE ${msg.type().toUpperCase()}] ${msg.text()}`);
    });
    
    page.on('pageerror', err => {
      console.error(`[PAGE ERROR]`, err);
    });
    
    console.log('Reloading page...');
    await page.reload();
    
    // Wait for errors to print
    await new Promise(resolve => setTimeout(resolve, 5000));
    console.log('Done listening.');
  } catch (err) {
    console.error('Error connecting or running:', err);
  }
})();
