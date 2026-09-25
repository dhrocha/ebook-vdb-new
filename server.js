require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const {
  resolvePdfSource,
  clientDownloadUrl,
  sanitize,
  isValidEmail,
  isValidPhone,
  sendLeadEmail,
  PDF_FILENAME,
  SENDGRID_API_KEY,
  IS_VERCEL,
} = require('./lib/shared');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '32kb' }));
app.use(express.urlencoded({ extended: false }));

const submitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Muitas tentativas. Tente novamente em alguns minutos.' },
});

app.post('/api/lead', submitLimiter, async (req, res) => {
  try {
    const name = sanitize(req.body.name, 120);
    const email = sanitize(req.body.email, 160).toLowerCase();
    const whatsapp = sanitize(req.body.whatsapp, 40);

    if (!name || !email || !whatsapp) {
      return res.status(400).json({ ok: false, error: 'Preencha todos os campos.' });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ ok: false, error: 'Informe um e-mail válido.' });
    }
    if (!isValidPhone(whatsapp)) {
      return res.status(400).json({ ok: false, error: 'Informe um WhatsApp válido.' });
    }

    const source = await resolvePdfSource();
    await sendLeadEmail({ name, email, whatsapp });

    return res.json({
      ok: true,
      downloadUrl: clientDownloadUrl(source),
      external: source.type !== 'local',
    });
  } catch (err) {
    console.error('[lead]', err);
    if (err.response && err.response.body) {
      console.error('[lead] sendgrid:', err.response.body);
    }
    return res.status(500).json({
      ok: false,
      error: 'Não foi possível processar o pedido. Tente novamente.',
    });
  }
});

app.get('/api/download', async (req, res) => {
  try {
    const source = await resolvePdfSource();

    if (source.type !== 'local') {
      return res.redirect(302, clientDownloadUrl(source));
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${PDF_FILENAME.replace(/"/g, '')}"`
    );
    res.setHeader('Cache-Control', 'no-store');

    const stat = fs.statSync(source.path);
    res.setHeader('Content-Length', stat.size);
    return fs.createReadStream(source.path).pipe(res);
  } catch (err) {
    console.error('[download]', err);
    return res.status(500).send('Não foi possível baixar o PDF. Tente novamente.');
  }
});

app.get('/api/health', async (_req, res) => {
  try {
    const source = await resolvePdfSource();
    res.json({
      ok: true,
      pdf: source.type,
      sendgrid: Boolean(SENDGRID_API_KEY),
      vercel: IS_VERCEL,
    });
  } catch (err) {
    res.status(503).json({ ok: false, error: err.message });
  }
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Ebook landing em http://localhost:${PORT}`);
  });
}

module.exports = app;
