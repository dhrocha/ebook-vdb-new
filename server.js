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

function driveDownloadUrl(fileId) {
  return `https://drive.google.com/uc?export=download&id=${fileId}`;
}

async function resolvePdfSource() {
  if (fs.existsSync(LOCAL_PDF)) {
    return { type: 'local', path: LOCAL_PDF };
  }

  const fileId = extractDriveFileId();
  if (!fileId) {
    throw new Error(
      'PDF não configurado. Defina GOOGLE_DRIVE_FILE_ID / GOOGLE_DRIVE_URL ou coloque o arquivo em public/assets/guia.pdf'
    );
  }

  return { type: 'drive', fileId, url: driveDownloadUrl(fileId) };
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

    // Garante que o PDF está acessível antes de confirmar o lead
    await resolvePdfSource();
    await sendLeadEmail({ name, email, whatsapp });

    return res.json({ ok: true, downloadUrl: '/api/download' });
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

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${PDF_FILENAME.replace(/"/g, '')}"`
    );
    res.setHeader('Cache-Control', 'no-store');

    if (source.type === 'local') {
      const stat = fs.statSync(source.path);
      res.setHeader('Content-Length', stat.size);
      return fs.createReadStream(source.path).pipe(res);
    }

    // Proxy do Drive: evita redirect no celular e força download
    const response = await fetch(source.url, {
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; VestidasDeBrancoEbook/1.0; +https://vestidasdebranco.com.br)',
      },
    });

    if (!response.ok) {
      throw new Error(`Falha ao obter PDF do Drive (HTTP ${response.status})`);
    }

    const contentType = response.headers.get('content-type') || '';
    // Drive às vezes devolve HTML de confirmação em arquivos grandes
    if (contentType.includes('text/html')) {
      throw new Error(
        'O Google Drive pediu confirmação extra. Baixe o PDF e coloque em public/assets/guia.pdf para download direto.'
      );
    }

    const length = response.headers.get('content-length');
    if (length) res.setHeader('Content-Length', length);

    const buffer = Buffer.from(await response.arrayBuffer());
    return res.end(buffer);
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
    });
  } catch (err) {
    res.status(503).json({ ok: false, error: err.message });
  }
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Ebook landing em http://localhost:${PORT}`);
});
