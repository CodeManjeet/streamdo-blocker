// Step 1: Dependencies
const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const { URL } = require('url');

// Step 2: Express app initialization
const app = express();
const port = process.env.PORT || 3000;

// Add CORS headers for Render deployment
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
    } else {
        next();
    }
});

// Add health check endpoint for Render
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', message: 'Proxy server is running' });
});

// Step 3: Root endpoint for proxying and ad-blocking
app.get('/', async (req, res) => {
    const targetUrl = req.query.url;

    if (!targetUrl) {
        return res.status(400).json({ 
            error: 'Please provide a ?url= parameter.',
            example: '?url=https://example.com'
        });
    }

    try {
        // Validate URL
        new URL(targetUrl);
        // Fetch the target URL's HTML
        const response = await axios.get(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            },
            timeout: 10000 // 10 second timeout
        });
        const html = response.data;

        // Load HTML with Cheerio
        const $ = cheerio.load(html);

        // Block unwanted scripts
        const blockedScriptSources = [
            // '/assets/jquery/css.js',
            // '/assets/jquery/css100.js',
            // 'bvtpk.com',
            // 'media.dalyio.com',
            // 'imasdk.googleapis.com',
            // 'cz.dyedmurders.com',
            // 'dyedmurders.com',
            // 'tag.min.js',
            // 'gpPTLMM0BJiUY6TQ'
        ];

        $('script').each((index, element) => {
            const scriptSrc = $(element).attr('src');
            const scriptContent = $(element).html();

            if (scriptSrc) {
                const shouldBlock = blockedScriptSources.some(blocked => {
                    if (scriptSrc.includes(blocked)) {
                        return true;
                    }
                    if (blocked.startsWith('/') && scriptSrc.split('?')[0].includes(blocked)) {
                        return true;
                    }
                    return false;
                });
                if (shouldBlock) {
                    $(element).remove();
                    return;
                }
            }

            if (!scriptSrc && scriptContent) {
                const shouldBlockInline = blockedScriptSources.some(blocked => {
                    return scriptContent.includes(blocked);
                });
                if (shouldBlockInline || scriptContent.includes('function(w,a)')) {
                    $(element).remove();
                }
            }
        });

        // Add <base> tag for relative paths
        const pageUrl = new URL(targetUrl);
        $('head').prepend(`<base href="${pageUrl.href}">`);

        // Send cleaned HTML with proper content type
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send($.html());
    } catch (error) {
        console.error('Error:', error.message);
        if (error.code === 'ENOTFOUND') {
            res.status(404).json({ error: 'URL not found or invalid' });
        } else if (error.code === 'ECONNABORTED') {
            res.status(408).json({ error: 'Request timeout' });
        } else {
            res.status(500).json({ error: `Error fetching URL: ${error.message}` });
        }
    }
});

// Universal CORS proxy endpoint for any resource (video, image, m3u8, js, etc.)
app.get('/proxy', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) {
        return res.status(400).json({ error: 'Please provide a ?url= parameter.' });
    }
    try {
        const response = await axios.get(targetUrl, {
            responseType: 'stream',
            headers: {
                'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
                // Forward referer if present (sometimes needed for video)
                ...(req.headers['referer'] ? { 'Referer': req.headers['referer'] } : {})
            },
            timeout: 15000
        });

        // Set CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');

        // Forward content-type and other headers
        if (response.headers['content-type']) {
            res.setHeader('Content-Type', response.headers['content-type']);
        }
        if (response.headers['content-length']) {
            res.setHeader('Content-Length', response.headers['content-length']);
        }
        if (response.headers['accept-ranges']) {
            res.setHeader('Accept-Ranges', response.headers['accept-ranges']);
        }
        if (response.headers['content-disposition']) {
            res.setHeader('Content-Disposition', response.headers['content-disposition']);
        }
        if (response.headers['cache-control']) {
            res.setHeader('Cache-Control', response.headers['cache-control']);
        }

        // Pipe the response
        response.data.pipe(res);
    } catch (error) {
        if (error.response) {
            res.status(error.response.status).json({ error: error.response.statusText });
        } else {
            res.status(500).json({ error: error.message });
        }
    }
});

// Step 4: Start the server
app.listen(port, '0.0.0.0', () => {
    console.log(`Ad-blocking proxy server running on port ${port}`);
    console.log(`Health check: http://localhost:${port}/health`);
});
