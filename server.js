/*
 * server.js
 *
 * A plain static file server, nothing more. High Noon is peer to peer now -
 * the rules, the clock and the scoring all live in the browser (GameHost.js),
 * so this process only hands out index.html, the scripts and the sounds.
 * No dependencies, no game state, no sockets.
 */
const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
const ROOT = __dirname;

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js':   'text/javascript; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.gif':  'image/gif',
    '.ico':  'image/x-icon',
    '.svg':  'image/svg+xml',
    '.mp3':  'audio/mpeg',
    '.wav':  'audio/wav'
};

const server = http.createServer((req, res) => {
    let urlPath;
    try {
        urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch (e) {
        res.writeHead(400).end('Bad request');
        return;
    }

    //App Engine health checks
    if (urlPath === '/_ah/health' || urlPath === '/liveness_check' || urlPath === '/readiness_check') {
        res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
        return;
    }

    if (urlPath === '/') urlPath = '/index.html';

    const filePath = path.join(ROOT, path.normalize(urlPath));
    if (!filePath.startsWith(ROOT)) {         //no climbing out of the saloon
        res.writeHead(403).end('Forbidden');
        return;
    }

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
            return;
        }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
        res.end(data);
    });
});

server.listen(PORT, () => console.log('High Noon static server listening on ' + PORT));
