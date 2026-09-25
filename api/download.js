const fs = require('fs');
const {
  resolvePdfSource,
  clientDownloadUrl,
  PDF_FILENAME,
} = require('../lib/shared');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    return res.end('Método não permitido.');
  }

  try {
    const source = await resolvePdfSource();

    if (source.type !== 'local') {
      res.statusCode = 302;
      res.setHeader('Location', clientDownloadUrl(source));
      return res.end();
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${PDF_FILENAME.replace(/"/g, '')}"`
    );
    res.setHeader('Cache-Control', 'no-store');

    const stat = fs.statSync(source.path);
    res.setHeader('Content-Length', String(stat.size));

    const stream = fs.createReadStream(source.path);
    stream.pipe(res);
  } catch (err) {
    console.error('[download]', err);
    res.statusCode = 500;
    res.end('Não foi possível baixar o PDF. Tente novamente.');
  }
};
