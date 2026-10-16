import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svga': 'application/octet-stream' };

createServer(async (request, response) => {
  try {
    const pathName = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
    const relative = normalize(pathName).replace(/^[/\\]+/, '') || 'index.html';
    const fullPath = join(root, relative);
    if (!fullPath.startsWith(root)) throw new Error('Forbidden');
    const info = await stat(fullPath);
    const filePath = info.isDirectory() ? join(fullPath, 'index.html') : fullPath;
    response.writeHead(200, { 'Content-Type': types[extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(await readFile(filePath));
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
}).listen(port, '0.0.0.0', () => console.log(`SVGA Thumbnail Studio: http://127.0.0.1:${port}`));
