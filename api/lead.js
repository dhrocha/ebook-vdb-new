const {
  resolvePdfSource,
  clientDownloadUrl,
  sanitize,
  isValidEmail,
  isValidPhone,
  sendLeadEmail,
  readJsonBody,
  sendJson,
} = require('../lib/shared');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  if (req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, error: 'Método não permitido.' });
  }

  try {
    const body = await readJsonBody(req);
    const name = sanitize(body.name, 120);
    const email = sanitize(body.email, 160).toLowerCase();
    const whatsapp = sanitize(body.whatsapp, 40);

    if (!name || !email || !whatsapp) {
      return sendJson(res, 400, { ok: false, error: 'Preencha todos os campos.' });
    }
    if (!isValidEmail(email)) {
      return sendJson(res, 400, { ok: false, error: 'Informe um e-mail válido.' });
    }
    if (!isValidPhone(whatsapp)) {
      return sendJson(res, 400, { ok: false, error: 'Informe um WhatsApp válido.' });
    }

    const source = await resolvePdfSource();
    await sendLeadEmail({ name, email, whatsapp });

    return sendJson(res, 200, {
      ok: true,
      downloadUrl: clientDownloadUrl(source),
      external: source.type !== 'local',
    });
  } catch (err) {
    console.error('[lead]', err);
    if (err.response && err.response.body) {
      console.error('[lead] sendgrid:', err.response.body);
    }
    return sendJson(res, 500, {
      ok: false,
      error: 'Não foi possível processar o pedido. Tente novamente.',
    });
  }
};
