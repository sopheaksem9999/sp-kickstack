import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { Express } from 'express';

export interface TestResponse {
  status: number;
  body: any;
  headers: Record<string, any>;
}

export async function testRequest(
  app: Express,
  method: string,
  url: string,
  options: { body?: any; headers?: Record<string, string> } = {}
): Promise<TestResponse> {
  return new Promise((resolve) => {
    const bodyStr = options.body !== undefined ? JSON.stringify(options.body) : '';
    const req: any = bodyStr ? Readable.from([Buffer.from(bodyStr)]) : Readable.from([]);

    req.method = method.toUpperCase();
    const parsedUrl = new URL(url, 'http://localhost');
    req.url = parsedUrl.pathname + parsedUrl.search;
    req.headers = {
      'content-type': 'application/json',
      ...(options.headers || {}),
    };

    if (bodyStr) {
      req.headers['content-length'] = String(Buffer.byteLength(bodyStr));
    }

    const res: any = new EventEmitter();
    res.statusCode = 200;
    res._headers = {};
    res.setHeader = (name: string, val: any) => {
      res._headers[name.toLowerCase()] = val;
    };
    res.getHeader = (name: string) => res._headers[name.toLowerCase()];
    res.removeHeader = (name: string) => {
      delete res._headers[name.toLowerCase()];
    };
    res.flushHeaders = () => {};

    let responseData = '';
    res.write = (chunk: any) => {
      responseData += chunk ? chunk.toString() : '';
      return true;
    };
    res.end = (chunk: any) => {
      if (chunk) responseData += chunk.toString();
      let parsedBody = responseData;
      try {
        parsedBody = JSON.parse(responseData);
      } catch {}
      resolve({
        status: res.statusCode,
        body: parsedBody,
        headers: res._headers,
      });
    };

    app.handle(req, res);
  });
}
