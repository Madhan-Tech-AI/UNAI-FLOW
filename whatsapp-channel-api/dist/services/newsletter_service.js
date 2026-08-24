"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NewsletterService = void 0;
const pino_1 = __importDefault(require("pino"));
const logger = (0, pino_1.default)({ level: 'info' });
class NewsletterService {
    /**
     * Discovers all WhatsApp Channels/Newsletters where the connected user is owner/admin or subscriber.
     */
    static async discoverChannels(sock) {
        const channels = [];
        const seenIds = new Set();
        try {
            // 1. Direct WMex Query for xwa2_newsletter_subscribed_list (Query ID: 6388546374527196)
            try {
                if (typeof sock.query === 'function') {
                    const generateMessageTag = sock.generateMessageTag || (() => `${Date.now()}`);
                    const mexResult = await sock.query({
                        tag: 'iq',
                        attrs: {
                            id: generateMessageTag(),
                            type: 'get',
                            to: 's.whatsapp.net',
                            xmlns: 'w:mex'
                        },
                        content: [
                            {
                                tag: 'query',
                                attrs: { query_id: '6388546374527196' },
                                content: Buffer.from(JSON.stringify({ variables: {} }), 'utf-8')
                            }
                        ]
                    });
                    // Parse result node from binary
                    const resultChild = mexResult?.content?.find?.((c) => c.tag === 'result');
                    if (resultChild?.content) {
                        const rawText = Buffer.isBuffer(resultChild.content)
                            ? resultChild.content.toString('utf-8')
                            : String(resultChild.content);
                        const parsed = JSON.parse(rawText);
                        const list = parsed?.data?.xwa2_newsletter_subscribed_list || [];
                        for (const item of list) {
                            const jid = item.id || item.jid;
                            if (jid && !seenIds.has(jid)) {
                                seenIds.add(jid);
                                const role = (item.viewer_metadata?.role || 'ADMIN').toLowerCase();
                                channels.push({
                                    id: jid,
                                    name: item.thread_metadata?.name?.text || item.name || 'WhatsApp Channel',
                                    link: item.thread_metadata?.invite
                                        ? `https://whatsapp.com/channel/${item.thread_metadata.invite}`
                                        : `https://whatsapp.com/channel/${jid.split('@')[0]}`,
                                    role: role,
                                    subscribers_count: parseInt(item.thread_metadata?.subscribers_count || '0', 10),
                                    verified: Boolean(item.thread_metadata?.verification === 'VERIFIED'),
                                    description: item.thread_metadata?.description?.text || '',
                                    pictureUrl: item.thread_metadata?.picture?.direct_path || '',
                                });
                            }
                        }
                    }
                }
            }
            catch (mexErr) {
                logger.warn({ err: mexErr }, '[WCA] WMex subscribed list query warning');
            }
            // 2. Query chat list from socket memory for any @newsletter JIDs
            try {
                const chatStore = sock.store?.chats?.all?.() || [];
                for (const c of chatStore) {
                    const jid = c.id || '';
                    if (jid.endsWith('@newsletter') && !seenIds.has(jid)) {
                        seenIds.add(jid);
                        // Try to get full metadata via socket if available
                        let meta = null;
                        try {
                            if (typeof sock.newsletterMetadata === 'function') {
                                meta = await sock.newsletterMetadata('jid', jid);
                            }
                        }
                        catch (e) { }
                        channels.push({
                            id: jid,
                            name: meta?.name || meta?.thread_metadata?.name?.text || c.name || 'WhatsApp Channel',
                            link: meta?.invite ? `https://whatsapp.com/channel/${meta.invite}` : `https://whatsapp.com/channel/${jid.split('@')[0]}`,
                            role: (meta?.viewer_metadata?.role?.toLowerCase() || 'admin'),
                            subscribers_count: meta?.thread_metadata?.subscribers_count || 0,
                            verified: Boolean(meta?.thread_metadata?.verification === 'VERIFIED'),
                            description: meta?.thread_metadata?.description?.text || '',
                        });
                    }
                }
            }
            catch (storeErr) {
                logger.debug({ err: storeErr }, '[WCA] Chat store scan note');
            }
            logger.info({ count: channels.length }, '[WCA] CHANNELS_DISCOVERED');
            return channels;
        }
        catch (err) {
            logger.error({ err }, '[WCA] Error during channel discovery');
            return channels;
        }
    }
    /**
     * Resolves a WhatsApp Channel / Newsletter by invite link, invite code, or JID.
     */
    static async resolveChannel(sock, linkOrCode) {
        const raw = (linkOrCode || '').trim();
        if (!raw)
            return null;
        logger.info({ linkOrCode: raw }, '[WCA] RESOLVE_CHANNEL_START');
        // 1. Check if it's an invite code or full URL
        const inviteMatch = raw.match(/(?:whatsapp\.com\/channel\/)?([a-zA-Z0-9_-]{15,35})/);
        const inviteCode = inviteMatch ? inviteMatch[1] : null;
        if (inviteCode && !raw.includes('@newsletter')) {
            try {
                if (typeof sock.newsletterMetadata === 'function') {
                    const meta = await sock.newsletterMetadata('invite', inviteCode);
                    if (meta && meta.id) {
                        const role = (meta.viewer_metadata?.role || 'ADMIN').toLowerCase();
                        logger.info({ id: meta.id, name: meta.name, role }, '[WCA] RESOLVE_CHANNEL_BY_INVITE_SUCCESS');
                        return {
                            id: meta.id,
                            name: meta.name || meta.thread_metadata?.name?.text || 'WhatsApp Channel',
                            link: `https://whatsapp.com/channel/${meta.invite || inviteCode}`,
                            role: role,
                            subscribers_count: parseInt(meta.thread_metadata?.subscribers_count || '0', 10),
                            verified: Boolean(meta.thread_metadata?.verification === 'VERIFIED'),
                            description: meta.thread_metadata?.description?.text || '',
                            pictureUrl: meta.thread_metadata?.picture?.direct_path || '',
                        };
                    }
                }
            }
            catch (err) {
                logger.warn({ err: err.message, inviteCode }, '[WCA] Failed to resolve channel by invite code');
            }
        }
        // 2. Resolve by JID
        const jid = raw.includes('@newsletter') ? raw : `${raw}@newsletter`;
        try {
            if (typeof sock.newsletterMetadata === 'function') {
                const meta = await sock.newsletterMetadata('jid', jid);
                if (meta && meta.id) {
                    const role = (meta.viewer_metadata?.role || 'ADMIN').toLowerCase();
                    logger.info({ id: meta.id, name: meta.name, role }, '[WCA] RESOLVE_CHANNEL_BY_JID_SUCCESS');
                    return {
                        id: meta.id,
                        name: meta.name || meta.thread_metadata?.name?.text || 'WhatsApp Channel',
                        link: meta.invite ? `https://whatsapp.com/channel/${meta.invite}` : `https://whatsapp.com/channel/${jid.split('@')[0]}`,
                        role: role,
                        subscribers_count: parseInt(meta.thread_metadata?.subscribers_count || '0', 10),
                        verified: Boolean(meta.thread_metadata?.verification === 'VERIFIED'),
                        description: meta.thread_metadata?.description?.text || '',
                        pictureUrl: meta.thread_metadata?.picture?.direct_path || '',
                    };
                }
            }
        }
        catch (err) {
            logger.warn({ err: err.message, jid }, '[WCA] Failed to resolve channel by JID');
        }
        return null;
    }
    /**
     * Fetches metadata for a specific WhatsApp Newsletter / Channel.
     */
    static async getChannelMetadata(sock, channelId) {
        return await this.resolveChannel(sock, channelId);
    }
    /**
     * Publishes message to a WhatsApp Channel (@newsletter JID) directly via WebSocket protocol.
     */
    static async publishToChannel(sock, channelId, messageContent) {
        const normalizedJid = channelId.includes('@') ? channelId : `${channelId}@newsletter`;
        logger.info({ jid: normalizedJid }, '⚡ Sending message to WhatsApp Newsletter / Channel via socket...');
        const sent = await sock.sendMessage(normalizedJid, messageContent);
        const postId = sent?.key?.id || `wa_msg_${Date.now()}`;
        const publishedAt = new Date().toISOString();
        return {
            success: true,
            postId,
            channelId: normalizedJid,
            publishedAt,
        };
    }
}
exports.NewsletterService = NewsletterService;
