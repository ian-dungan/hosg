// ============================================================
// Simple Node.js Static File Server for Babylon.js Project
// This allows Render to host the client-side game files.
// ============================================================
const http = require('http');
const fs = require('fs');
const path = require('path');

const port = process.env.PORT || 3000;

// List of Mime Types to correctly serve all game assets
const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.jpg': 'image/jpeg',
    '.png': 'image/png',
    '.hdr': 'application/octet-stream', // Crucial for HDRI textures
    '.gltf': 'model/gltf+json',
    '.glb': 'model/gltf-binary'
};

function serveStatic(req, res) {
    // Determine the requested file path
    let filePath = req.url === '/' ? 'index.html' : req.url;
    
    // Resolve the path relative to the server's root directory
    let fullPath = path.join(__dirname, filePath);
    
    // Get the MIME type from the file extension
    const extname = String(path.extname(fullPath)).toLowerCase();
    const contentType = mimeTypes[extname] || 'application/octet-stream';

    fs.readFile(fullPath, (error, content) => {
        if (error) {
            // Log 404 errors (this will show if your HDRI is still failing)
            if (error.code === 'ENOENT') {
                console.warn(`[SERVER] 404 Not Found: ${req.url}`);
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('404 Not Found');
            } else {
                res.writeHead(500);
                res.end('Internal Server Error: ' + error.code);
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
}

const server = http.createServer(serveStatic);

server.listen(port, () => {
    console.log(`Node.js Static Server listening on port ${port}`);
});
