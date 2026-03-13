import fs from 'fs';
import os from 'os';
import path from 'path';
import pino from 'pino';
import pn from 'awesome-phonenumber';
import {
  makeWASocket,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  Browsers,
  fetchLatestBaileysVersion,
  delay,
} from '@whiskeysockets/baileys';

function removeDir(dirPath) {
  try {
    if (fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true });
    }
  } catch (err) {
    console.error('Cleanup error:', err);
  }
}

function safeNumber(raw) {
  const cleaned = String(raw || '').replace(/[^0-9]/g, '');
  const phone = pn('+' + cleaned);
  if (!cleaned || !phone.isValid()) return null;
  return phone.getNumber('e164').replace('+', '');
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ code: 'Method not allowed' });
  }

  const num = safeNumber(req.query.number);
  if (!num) {
    return res.status(400).json({
      code: 'Invalid phone number. Use full international format without + or spaces. Example: 9477XXXXXXX'
    });
  }

  const sessionDir = path.join(os.tmpdir(), `wa-session-${num}-${Date.now()}`);
  let sock;

  try {
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(
          state.keys,
          pino({ level: 'silent' }).child({ level: 'silent' })
        ),
      },
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      browser: Browsers.windows('Chrome'),
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
      defaultQueryTimeoutMs: 60000,
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 10000,
    });

    sock.ev.on('creds.update', saveCreds);

    await delay(2500);
    let code = await sock.requestPairingCode(num);
    code = code?.match(/.{1,4}/g)?.join('-') || code;

    return res.status(200).json({
      success: true,
      number: num,
      code,
      note: 'This Vercel version is for pairing-code generation only.'
    });
  } catch (error) {
    console.error('Pair route error:', error);
    return res.status(500).json({
      success: false,
      code: 'Failed to generate pairing code on Vercel.',
      error: error?.message || 'Unknown error'
    });
  } finally {
    try {
      if (sock?.ws?.close) sock.ws.close();
      if (sock?.end) sock.end(new Error('Request finished'));
    } catch {}
    removeDir(sessionDir);
  }
}
