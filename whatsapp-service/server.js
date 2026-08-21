const express = require('express');
const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

// In-memory session store
const sessions = {};

// Helper to start a socket for a session
async function startSession(sessionId) {
    if (sessions[sessionId] && sessions[sessionId].status === 'CONNECTED') {
        return sessions[sessionId];
    }

    const authFolder = path.join(__dirname, 'auth_info', sessionId);
    if (!fs.existsSync(authFolder)) {
        fs.mkdirSync(authFolder, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(authFolder);

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ['UNAI Flow', 'Chrome', '1.0.0']
    });

    sessions[sessionId] = {
        sock,
        status: 'INITIALIZING',
        qr: null,
    };

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        const s = sessions[sessionId];
        if (!s) return;

        if (qr) {
            s.qr = await QRCode.toDataURL(qr);
            s.status = 'WAITING_FOR_SCAN';
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                console.log(`Connection closed for ${sessionId}, reconnecting...`);
                startSession(sessionId);
            } else {
                console.log(`Connection closed for ${sessionId}, logged out.`);
                s.status = 'DISCONNECTED';
                s.qr = null;
                // Delete auth folder?
            }
        } else if (connection === 'open') {
            console.log(`Opened connection for ${sessionId}`);
            s.status = 'CONNECTED';
            s.qr = null;
        }
    });

    return sessions[sessionId];
}

app.post('/session/start', async (req, res) => {
    const { session_identifier } = req.body;
    if (!session_identifier) return res.status(400).json({ error: 'Missing session_identifier' });
    
    await startSession(session_identifier);
    res.json({ success: true, status: 'INITIALIZING' });
});

app.get('/session/status', (req, res) => {
    const { session_identifier } = req.query;
    const session = sessions[session_identifier];
    if (!session) {
        // Might exist in disk, start it
        startSession(session_identifier);
        return res.json({ success: true, status: 'INITIALIZING' });
    }

    res.json({
        success: true,
        status: session.status,
        qr: session.qr
    });
});

app.get('/channels', async (req, res) => {
    const { session_identifier } = req.query;
    const session = sessions[session_identifier];
    if (!session || session.status !== 'CONNECTED') {
        return res.status(400).json({ error: 'Session not connected' });
    }

    try {
        // Subscribed newsletters (channels)
        const newsletters = await session.sock.newsletterSubscribed();
        const channels = newsletters.map(n => ({
            id: n.id,
            name: n.name,
            role: n.role,
            picture: n.picture,
            followers: 0 // Optional fetch
        }));
        // Filter to only channels where user is ADMIN or GUEST (owns/manages)
        const managedChannels = channels.filter(c => c.role === 'ADMIN' || c.role === 'OWNER' || c.role === 'GUEST');
        
        // If empty, just return all for testing purposes
        const results = managedChannels.length > 0 ? managedChannels : channels;
        
        res.json({ success: true, channels: results });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/channels/publish', async (req, res) => {
    const { session_identifier, channel_id, type, body } = req.body;
    const session = sessions[session_identifier];
    if (!session || session.status !== 'CONNECTED') {
        return res.status(400).json({ error: 'Session not connected' });
    }

    try {
        let msgRes;
        if (type === 'text') {
            msgRes = await session.sock.sendMessage(channel_id, { text: body });
        } else {
            return res.status(400).json({ error: 'Unsupported message type' });
        }
        res.json({ success: true, message_id: msgRes.key.id });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`WhatsApp Baileys service listening on port ${PORT}`);
});
