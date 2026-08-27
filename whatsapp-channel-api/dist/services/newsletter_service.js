"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NewsletterService = void 0;
const pino_1 = __importDefault(require("pino"));
const logger = (0, pino_1.default)({ level: 'info' });
class NewsletterService {
    // Discovery cache with 30s TTL to prevent WhatsApp MEX rate-overlimit errors
    static discoveryCache = new Map();
    /**
     * Discovers all WhatsApp Channels/Newsletters where the connected user is owner/admin or subscriber.
     * Fetches real avatars, exact subscriber counts, verification status, and admin roles.
     */
    static async discoverChannels(sock, connectionKey = 'default') {
        const cached = this.discoveryCache.get(connectionKey);
        if (cached && (Date.now() - cached.timestamp < 30000) && cached.channels.length > 0) {
            logger.info({ count: cached.channels.length, ageMs: Date.now() - cached.timestamp }, '[WCA] CHANNELS_SERVED_FROM_CACHE');
            return cached.channels;
        }
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
                                const rawRole = (item.viewer_metadata?.role || 'ADMIN').toLowerCase();
                                const role = ['owner', 'admin', 'subscriber', 'guest'].includes(rawRole) ? rawRole : 'admin';
                                // Try fetching full profile picture URL via Baileys
                                let pictureUrl = item.thread_metadata?.picture?.direct_path || null;
                                try {
                                    if (typeof sock.profilePictureUrl === 'function') {
                                        const fullUrl = await sock.profilePictureUrl(jid, 'image');
                                        if (fullUrl)
                                            pictureUrl = fullUrl;
                                    }
                                }
                                catch { }
                                // Parse subscriber count safely (preserve null if unavailable)
                                let subscribers_count = null;
                                if (item.thread_metadata?.subscribers_count !== undefined && item.thread_metadata?.subscribers_count !== null) {
                                    const parsedSubs = parseInt(item.thread_metadata.subscribers_count, 10);
                                    if (!isNaN(parsedSubs)) {
                                        subscribers_count = parsedSubs;
                                    }
                                }
                                const inviteCode = item.thread_metadata?.invite || jid.split('@')[0];
                                const realJid = jid.includes('@') ? jid : `${jid}@newsletter`;
                                this.jidCache.set(inviteCode, realJid);
                                channels.push({
                                    id: inviteCode,
                                    name: item.thread_metadata?.name?.text || item.name || 'WhatsApp Channel',
                                    link: item.thread_metadata?.invite
                                        ? `https://whatsapp.com/channel/${item.thread_metadata.invite}`
                                        : `https://whatsapp.com/channel/${jid.split('@')[0]}`,
                                    role,
                                    can_publish: role === 'owner' || role === 'admin',
                                    subscribers_count,
                                    verified: Boolean(item.thread_metadata?.verification === 'VERIFIED'),
                                    description: item.thread_metadata?.description?.text || '',
                                    pictureUrl,
                                });
                            }
                        }
                    }
                }
            }
            catch (mexErr) {
                logger.warn({ err: mexErr.message || mexErr }, '[WCA] WMex subscribed list query warning');
            }
            // 2. Query chat list from socket memory for any @newsletter JIDs
            try {
                const chatStore = sock.store?.chats?.all?.() || [];
                for (const c of chatStore) {
                    const jid = c.id || '';
                    if (jid.endsWith('@newsletter') && !seenIds.has(jid)) {
                        seenIds.add(jid);
                        let meta = null;
                        try {
                            if (typeof sock.newsletterMetadata === 'function') {
                                meta = await sock.newsletterMetadata('jid', jid);
                            }
                        }
                        catch (e) { }
                        let pictureUrl = meta?.thread_metadata?.picture?.direct_path || null;
                        try {
                            if (typeof sock.profilePictureUrl === 'function') {
                                const fullUrl = await sock.profilePictureUrl(jid, 'image');
                                if (fullUrl)
                                    pictureUrl = fullUrl;
                            }
                        }
                        catch { }
                        let subscribers_count = null;
                        const rawSubs = meta?.thread_metadata?.subscribers_count;
                        if (rawSubs !== undefined && rawSubs !== null) {
                            const parsedSubs = parseInt(rawSubs, 10);
                            if (!isNaN(parsedSubs))
                                subscribers_count = parsedSubs;
                        }
                        const rawRole = (meta?.viewer_metadata?.role || 'admin').toLowerCase();
                        const role = ['owner', 'admin', 'subscriber', 'guest'].includes(rawRole) ? rawRole : 'admin';
                        const inviteCode = meta?.invite || jid.split('@')[0];
                        const realJid = jid.includes('@') ? jid : `${jid}@newsletter`;
                        this.jidCache.set(inviteCode, realJid);
                        channels.push({
                            id: inviteCode,
                            name: meta?.name || meta?.thread_metadata?.name?.text || c.name || 'WhatsApp Channel',
                            link: meta?.invite ? `https://whatsapp.com/channel/${meta.invite}` : `https://whatsapp.com/channel/${jid.split('@')[0]}`,
                            role,
                            can_publish: role === 'owner' || role === 'admin',
                            subscribers_count,
                            verified: Boolean(meta?.thread_metadata?.verification === 'VERIFIED'),
                            description: meta?.thread_metadata?.description?.text || '',
                            pictureUrl,
                        });
                    }
                }
            }
            catch (storeErr) {
                logger.debug({ err: storeErr }, '[WCA] Chat store scan note');
            }
            logger.info({ count: channels.length, connectionKey }, '[WCA] CHANNELS_DISCOVERED');
            if (channels.length > 0) {
                this.discoveryCache.set(connectionKey, { channels, timestamp: Date.now() });
            }
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
                        // Try to get full profile picture URL
                        let pictureUrl = meta.thread_metadata?.picture?.direct_path || '';
                        try {
                            const fullUrl = await sock.profilePictureUrl(meta.id, 'image');
                            if (fullUrl)
                                pictureUrl = fullUrl;
                        }
                        catch { }
                        logger.info({ id: meta.id, name: meta.name, role }, '[WCA] RESOLVE_CHANNEL_BY_INVITE_SUCCESS');
                        // Cache the invite code → real JID mapping for fast publishes
                        const realJid = meta.id.includes('@') ? meta.id : `${meta.id}@newsletter`;
                        this.jidCache.set(inviteCode, realJid);
                        return {
                            id: meta.id,
                            name: meta.name || meta.thread_metadata?.name?.text || 'WhatsApp Channel',
                            link: `https://whatsapp.com/channel/${meta.invite || inviteCode}`,
                            role: role,
                            subscribers_count: meta.thread_metadata?.subscribers_count !== undefined ? parseInt(meta.thread_metadata.subscribers_count, 10) : null,
                            verified: Boolean(meta.thread_metadata?.verification === 'VERIFIED'),
                            can_publish: role === 'owner' || role === 'admin',
                            description: meta.thread_metadata?.description?.text || '',
                            pictureUrl,
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
                    // Try to get full profile picture URL
                    let pictureUrl = meta.thread_metadata?.picture?.direct_path || '';
                    try {
                        const fullUrl = await sock.profilePictureUrl(meta.id, 'image');
                        if (fullUrl)
                            pictureUrl = fullUrl;
                    }
                    catch { }
                    logger.info({ id: meta.id, name: meta.name, role }, '[WCA] RESOLVE_CHANNEL_BY_JID_SUCCESS');
                    return {
                        id: meta.id,
                        name: meta.name || meta.thread_metadata?.name?.text || 'WhatsApp Channel',
                        link: meta.invite ? `https://whatsapp.com/channel/${meta.invite}` : `https://whatsapp.com/channel/${jid.split('@')[0]}`,
                        role: role,
                        subscribers_count: meta.thread_metadata?.subscribers_count !== undefined ? parseInt(meta.thread_metadata.subscribers_count, 10) : null,
                        verified: Boolean(meta.thread_metadata?.verification === 'VERIFIED'),
                        can_publish: role === 'owner' || role === 'admin',
                        description: meta.thread_metadata?.description?.text || '',
                        pictureUrl,
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
    // In-memory cache: invite code → real newsletter JID
    static jidCache = new Map();
    /**
     * Publishes message to a WhatsApp Channel (@newsletter JID) directly via WebSocket protocol.
     * Automatically resolves invite codes to real JIDs before sending.
     */
    static async publishToChannel(sock, channelId, messageContent) {
        let normalizedJid = channelId.includes('@') ? channelId : `${channelId}@newsletter`;
        // Check if the JID looks like an invite code (non-numeric prefix before @newsletter)
        // Real newsletter JIDs are numeric like 120363427512887572@newsletter
        // Invite codes are alphanumeric like 0029VbDxqHz6hENhNBcZM31M
        const jidPrefix = normalizedJid.split('@')[0];
        const isLikelyInviteCode = /[a-zA-Z]/.test(jidPrefix);
        if (isLikelyInviteCode) {
            // Check cache first
            if (this.jidCache.has(jidPrefix)) {
                normalizedJid = this.jidCache.get(jidPrefix);
                logger.info({ inviteCode: jidPrefix, resolvedJid: normalizedJid }, '[WCA] PUBLISH_JID_FROM_CACHE');
            }
            else {
                // Resolve invite code to real JID via Baileys
                try {
                    logger.info({ inviteCode: jidPrefix }, '[WCA] PUBLISH_RESOLVING_INVITE_CODE');
                    if (typeof sock.newsletterMetadata === 'function') {
                        const meta = await sock.newsletterMetadata('invite', jidPrefix);
                        if (meta && meta.id) {
                            const realJid = meta.id.includes('@') ? meta.id : `${meta.id}@newsletter`;
                            this.jidCache.set(jidPrefix, realJid);
                            logger.info({ inviteCode: jidPrefix, resolvedJid: realJid }, '[WCA] PUBLISH_INVITE_RESOLVED');
                            normalizedJid = realJid;
                        }
                    }
                }
                catch (resolveErr) {
                    logger.warn({ err: resolveErr.message, inviteCode: jidPrefix }, '[WCA] PUBLISH_INVITE_RESOLVE_FAILED, sending to raw JID');
                }
            }
        }
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
