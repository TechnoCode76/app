/* eslint-disable no-console */

const url = require('url');
const path = require('path');
const fs = require('fs');

const yaml = require('js-yaml');
const express = require('express');
const favicon = require('serve-favicon');
const morgan = require('morgan');
const bodyParser = require('body-parser');
const serveStatic = require('serve-static');

const makeAssetPath = require('./assetPath');
const Queue = require('./queue');
const { getClient } = require('./db');

const routes = require('./routes');
const api = require('./api');

const env = process.env.NODE_ENV || 'development';
const DEV = env !== 'production';

const rootPath = path.join(__dirname, '..');
const configPath =
  process.env.CONFIG || path.join(__dirname, '..', `config.${env}.yml`);
const config = yaml.safeLoad(fs.readFileSync(configPath, 'utf8'));

const port = process.env.PORT || 3000;
const { hostname = 'http://localhost' } = config.server || {};

const app = express();

const base = DEV ? `${hostname}:${port}` : hostname;
const publicPath = '/public';
const distDir = path.join(rootPath, 'dist');
const assetPath = makeAssetPath(base, publicPath);

app.locals.config = config;
app.locals.hostname = hostname;
app.locals.title = 'Sound Slice';
app.locals.description =
  'Sound Slice lets you listen, extract, download and share specific moments of a song or an external audio source.';
app.locals.assetPath = assetPath;
app.locals.queue = new Queue(5);

app.use(favicon(path.join(distDir, assetPath('favicon.ico', false))));
app.use(morgan(env === 'development' ? 'dev' : 'tiny'));
app.use('/public', serveStatic(distDir));
app.use('/', function setResponseLocals(req, res, next) {
  res.locals.url = url.resolve(hostname, req.originalUrl);
  next();
});

app.get('/robots.txt', function serveRobots(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
  });
  res.end(`
    User-agent: *
    Disallow: ${config.SEO ? '' : '/'}
  `);
});

if (!DEV) {
  const sw = fs.readFileSync(path.join(distDir, 'service-worker.js'));
  app.get('/service-worker.js', function serveServiceWorker(req, res) {
    res.writeHead(200, {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(sw);
  });
}

const manifest = JSON.parse(
  fs.readFileSync(path.join(distDir, assetPath('manifest.webmanifest', false)))
);
manifest.icons.push(
  {
    src: assetPath('img/logo-192.png'),
    sizes: '192x192',
    type: 'image/png',
  },
  {
    src: assetPath('img/logo-512.png'),
    sizes: '512x512',
    type: 'image/png',
  }
);
app.get('/manifest.webmanifest', function serveManifest(req, res) {
  res.writeHead(200, {
    'Content-Type': 'application/manifest+json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(manifest));
});

app.get('/', routes.home);
app.get('/play', routes.play);
app.get('/shared/:id', routes.shared);
app.get('/link', routes.link);
app.get('/saved/:type/:id', routes.saved);

app.post('/api/link', bodyParser.json(), api.link);
app.get('/api/slice/:id', api.getSlice);
app.head('/api/slice/:id', api.headSlice);
app.delete('/api/slice/:id', api.deleteSlice);
app.post('/api/share', api.shareSlice);

app.listen(port, async function start() {
  console.info(`Sound Slice HTTP Server now listening on port ${port}`);
  try {
    const client = await getClient();
    client.release();
    console.info('Succesfuly retrieved and released database client');
  } catch (err) {
    console.error('Unable to retrieve or release database client. \n', err);
  }
});
