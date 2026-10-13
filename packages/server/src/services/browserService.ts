import type { BrowserPageContent } from '@sp-kickstack/shared';

export class BrowserService {
  isValidUrl(urlString: string): boolean {
    try {
      const url = new URL(urlString);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  parseHtmlContent(url: string, html: string): BrowserPageContent {
    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : url;

    // Extract headings (h1, h2, h3)
    const headings: string[] = [];
    const headingMatches = html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi);
    for (const match of headingMatches) {
      const rawText = match[1].replace(/<[^>]+>/g, '').trim();
      if (rawText && !headings.includes(rawText)) {
        headings.push(rawText);
      }
    }

    // Clean body HTML: strip scripts, styles, nav, footer, header
    let body = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<header[\s\S]*?<\/header>/gi, '');

    // Convert code blocks and paragraphs to text
    body = body
      .replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '\n```\n$1\n```\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"');

    // Normalize whitespace
    const textContent = body
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join('\n')
      .slice(0, 50000); // 50KB character limit for prompt context

    return {
      url,
      title,
      textContent,
      headings,
    };
  }

  async fetchPage(targetUrl: string): Promise<BrowserPageContent> {
    if (!this.isValidUrl(targetUrl)) {
      return {
        url: targetUrl,
        title: 'Invalid URL',
        textContent: '',
        headings: [],
        error: 'Only HTTP and HTTPS URLs are supported.',
      };
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const res = await fetch(targetUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; SP-Kickstack-Reader/1.0)',
          Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
        },
      });
      clearTimeout(timeout);

      if (!res.ok) {
        return {
          url: targetUrl,
          title: `HTTP ${res.status}`,
          textContent: '',
          headings: [],
          error: `Failed to load page: HTTP ${res.status} ${res.statusText}`,
        };
      }

      const html = await res.text();
      return this.parseHtmlContent(targetUrl, html);
    } catch (err: any) {
      return {
        url: targetUrl,
        title: 'Error loading page',
        textContent: '',
        headings: [],
        error: err?.message || 'Network request failed',
      };
    }
  }
}
