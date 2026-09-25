try {
  require('dotenv').config();
} catch (_) {
  // dotenv opcional na Vercel (env vars já injetadas)
}

const path = require('path');
const fs = require('fs');
const sgMail = require('@sendgrid/mail');

const LOCAL_PDF = path.join(__dirname, '..', 'public', 'assets', 'guia.pdf');
const PDF_FILENAME =
  process.env.PDF_FILENAME || 'guia-completo-vestidas-de-branco.pdf';
const IS_VERCEL = Boolean(process.env.VERCEL);

const SENDGRID_API_KEY = (process.env.SENDGRID_API_KEY || '').trim();
if (SENDGRID_API_KEY) {
  sgMail.setApiKey(SENDGRID_API_KEY);
}

function extractDriveFileId() {
  const raw = (process.env.GOOGLE_DRIVE_URL || process.env.GOOGLE_DRIVE_FILE_ID || '').trim();
  if (!raw) return '';
  const match = raw.match(/\/d\/([a-zA-Z0-9_-]+)/) || raw.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  if (/^[a-zA-Z0-9_-]+$/.test(raw)) return raw;
  return '';
}

function driveDirectDownloadUrl(fileId) {
  return `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`;
}

function hasLocalPdf() {
  try {
    return fs.existsSync(LOCAL_PDF);
  } catch {
    return false;
  }
}

async function resolvePdfSource() {
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
  };
}

function clientDownloadUrl(source) {
  if (source.type === 'local') return '/api/download';
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

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === 'object') {
      resolve(req.body);
      return;
    }

    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 32 * 1024) {
        reject(new Error('Payload muito grande'));
      }
    });
    req.on('end', () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify(payload));
}

module.exports = {
  LOCAL_PDF,
  PDF_FILENAME,
  IS_VERCEL,
  SENDGRID_API_KEY,
  resolvePdfSource,
  clientDownloadUrl,
  sanitize,
  isValidEmail,
  isValidPhone,
  sendLeadEmail,
  readJsonBody,
  sendJson,
  hasLocalPdf,
};
