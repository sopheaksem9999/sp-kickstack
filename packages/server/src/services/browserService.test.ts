import { describe, it, expect } from 'vitest';
import { BrowserService } from './browserService.js';

describe('BrowserService', () => {
  const service = new BrowserService();

  it('validates and normalizes safe URLs', () => {
    expect(service.isValidUrl('https://example.com/docs')).toBe(true);
    expect(service.isValidUrl('http://localhost:5173')).toBe(true);
    expect(service.isValidUrl('http://127.0.0.1:4100')).toBe(true);
    expect(service.isValidUrl('javascript:alert(1)')).toBe(false);
    expect(service.isValidUrl('file:///etc/passwd')).toBe(false);
  });

  it('extracts headings and text content from HTML', () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head><title>My Documentation</title></head>
        <body>
          <header><nav>Navigation</nav></header>
          <h1>API Overview</h1>
          <p>Welcome to our developer platform.</p>
          <h2>Getting Started</h2>
          <pre><code>npm install sp-kickstack</code></pre>
          <footer>Footer links</footer>
        </body>
      </html>
    `;
    const parsed = service.parseHtmlContent('https://example.com/api', html);
    expect(parsed.title).toBe('My Documentation');
    expect(parsed.headings).toEqual(['API Overview', 'Getting Started']);
    expect(parsed.textContent).toContain('Welcome to our developer platform');
    expect(parsed.textContent).toContain('npm install sp-kickstack');
    // Header and footer are trimmed/cleaned
    expect(parsed.textContent).not.toContain('Navigation');
  });
});
