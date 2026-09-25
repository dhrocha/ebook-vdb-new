require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const sgMail = require('@sendgrid/mail');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const LOCAL_PDF = path.join(__dirname, 'public', 'assets', 'guia.pdf');
const PDF_FILENAME =
  process.env.PDF_FILENAME || 'guia-completo-vestidas-de-branco.pdf';
const IS_VERCEL = Boolean(process.env.VERCEL);

const SENDGRID_API_KEY = (process.env.SENDGRID_API_KEY || '').trim();
if (SENDGRID_API_KEY) {
  sgMail.setApiKey(SENDGRID_API_KEY);
}

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

function extractDriveFileId() {
  const raw = (process.env.GOOGLE_DRIVE_URL || process.env.GOOGLE_DRIVE_FILE_ID || '').trim();
  if (!raw) return '';
  const match = raw.match(/\/d\/([a-zA-Z0-9_-]+)/) || raw.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  if (/^[a-zA-Z0-9_-]+$/.test(raw)) return raw;
  return '';
}

function driveDirectDownloadUrl(fileId) {
  // confirm=t evita a tela intermediária do Drive em arquivos grandes
  return `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`;
}

function driveDownloadUrl(fileId) {
  return `https://drive.google.com/uc?export=download&id=${fileId}`;
}

function hasLocalPdf() {
  try {
    return fs.existsSync(LOCAL_PDF);
  } catch {
    return false;
  }
}

async function resolvePdfSource() {
  // Na Vercel o PDF local (~95MB) não cabe no deploy serverless
  if (!IS_VERCEL && hasLocalPdf()) {
    return { type: 'local', path: LOCAL_PDF };
  }

  if (process.env.PDF_PUBLIC_URL) {
    return { type: 'public', url: process.env.PDF_PUBLIC_URL.trim() };
  }

  const fileId = extractDriveFileId();
  if (!fileId) {
    throw new Error(
      'PDF não configurado. Defina GOOGLE_DRIVE_FILE_ID / PDF_PUBLIC_URL ou coloque public/assets/guia.pdf (só fora da Vercel).'
    );
  }

  return {
    type: 'drive',
    fileId,
    url: driveDirectDownloadUrl(fileId),
    proxyUrl: driveDownloadUrl(fileId),
  };
}

/** URL que o browser usa para baixar (sem passar 95MB pela function da Vercel). */
function clientDownloadUrl(source) {
  if (source.type === 'local') return '/api/download';
  if (source.type === 'public') return source.url;
  return source.url;
}

function sanitize(value, max = 200) {
  return String(value || '')
    .trim()
    .replace(/[\r\n<>]/g, ' ')
    .slice(0, max);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPhone(phone) {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15;
}

async function sendLeadEmail({ name, email, whatsapp }) {
  if (!SENDGRID_API_KEY) {
    console.warn('[lead] SENDGRID_API_KEY não configurada — lead sem e-mail:', {
      name,
      email,
      whatsapp,
    });
    return { sent: false };
  }

  const mailTo = process.env.MAIL_TO || 'contato@vestidasdebranco.com.br';
  const mailFrom = process.env.MAIL_FROM || 'contato@vestidasdebranco.com.br';

  const subject = `Novo lead do ebook — ${name}`;
  const text = [
    'Novo cadastro no guia completo:',
    '',
    `Nome: ${name}`,
    `E-mail: ${email}`,
    `WhatsApp: ${whatsapp}`,
    '',
    `Data: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
  ].join('\n');

  const html = `
    <h2>Novo cadastro no guia completo</h2>
    <p><strong>Nome:</strong> ${name}</p>
    <p><strong>E-mail:</strong> ${email}</p>
    <p><strong>WhatsApp:</strong> ${whatsapp}</p>
    <p><strong>Data:</strong> ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</p>
  `;

  await sgMail.send({
    to: mailTo,
    from: mailFrom,
    replyTo: email,
    subject,
    text,
    html,
  });

  return { sent: true };
}

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

    // Na Vercel / arquivo remoto: redireciona (function não aguenta ~95MB)
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

// Em local, Express serve o front. Na Vercel, a pasta public/ é estática.
if (!IS_VERCEL) {
  app.use(express.static(path.join(__dirname, 'public')));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });
}

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Ebook landing em http://localhost:${PORT}`);
  });
}

module.exports = app;
