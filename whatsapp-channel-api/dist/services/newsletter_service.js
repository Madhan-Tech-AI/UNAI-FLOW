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
    // In-memory cache: invite code / raw ID → real numeric newsletter JID
    static jidCache = new Map();
    /**
     * Decodes HTML entities like &#039;, &amp;, &quot; into plain text.
     */
    static decodeHtmlEntities(text) {
        if (!text)
            return '';
        return text
            .replace(/&#039;/g, "'")
            .replace(/&apos;/g, "'")
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .trim();
    }
    /**
     * Cleans URL strings, unescaping HTML entities like &amp;.
     */
    static cleanUrl(url) {
        if (!url)
            return null;
        return url.replace(/&amp;/g, '&').trim();
    }
    /**
     * Safely extracts the highest-quality profile picture URL from metadata or direct_path.
     */
    static extractPictureUrl(fullMeta, rawItem) {
        const thread = fullMeta?.thread_metadata || rawItem?.thread_metadata;
        const picObj = thread?.picture || fullMeta?.picture || rawItem?.picture;
        const prevObj = thread?.preview || fullMeta?.preview || rawItem?.preview;
        // 1. Check full URLs
        if (picObj?.url && typeof picObj.url === 'string' && picObj.url.startsWith('http')) {
            return this.cleanUrl(picObj.url);
        }
        if (prevObj?.url && typeof prevObj.url === 'string' && prevObj.url.startsWith('http')) {
            return this.cleanUrl(prevObj.url);
        }
        // 2. Check direct_path and convert to WhatsApp CDN URL (https://mmg.whatsapp.net)
        const directPath = picObj?.direct_path || picObj?.directPath || prevObj?.direct_path || prevObj?.directPath;
        if (directPath && typeof directPath === 'string') {
            if (directPath.startsWith('http')) {
                return this.cleanUrl(directPath);
            }
            const normalizedPath = directPath.startsWith('/') ? directPath : `/${directPath}`;
            return this.cleanUrl(`https://mmg.whatsapp.net${normalizedPath}`);
        }
        return null;
    }
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
                            xmlns: 'w:mex',
                        },
                        content: [
                            {
                                tag: 'query',
                                attrs: { query_id: '6388546374527196' },
                                content: Buffer.from(JSON.stringify({ variables: {} }), 'utf-8'),
                            },
                        ],
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
                                const realJid = jid.includes('@') ? jid : `${jid}@newsletter`;
                                const rawRole = (item.viewer_metadata?.role || 'ADMIN').toLowerCase();
                                const role = ['owner', 'admin', 'subscriber', 'guest'].includes(rawRole) ? rawRole : 'admin';
                                // Fetch authoritative live metadata (subscribers count, full avatar URL) via Baileys
                                let fullMeta = null;
                                try {
                                    if (typeof sock.newsletterMetadata === 'function') {
                                        fullMeta = await sock.newsletterMetadata('jid', realJid);
                                    }
                                }
                                catch (metaErr) {
                                    logger.warn({ jid: realJid, err: metaErr?.message }, '[WCA] newsletterMetadata call note');
                                }
                                // Parse exact subscriber count
                                let subscribers_count = null;
                                const rawSubs = fullMeta?.thread_metadata?.subscribers_count ?? fullMeta?.subscribers ?? item.thread_metadata?.subscribers_count;
                                if (rawSubs !== undefined && rawSubs !== null) {
                                    const parsedSubs = parseInt(String(rawSubs), 10);
                                    if (!isNaN(parsedSubs)) {
                                        subscribers_count = parsedSubs;
                                    }
                                }
                                // Resolve full picture URL
                                const pictureUrl = this.extractPictureUrl(fullMeta, item);
                                const inviteCode = fullMeta?.thread_metadata?.invite || item.thread_metadata?.invite || realJid.split('@')[0];
                                // Cache mappings
                                this.jidCache.set(inviteCode, realJid);
                                this.jidCache.set(realJid, realJid);
                                this.jidCache.set(realJid.split('@')[0], realJid);
                                const channelName = this.decodeHtmlEntities(fullMeta?.thread_metadata?.name?.text || fullMeta?.name || item.thread_metadata?.name?.text || item.name || 'WhatsApp Channel');
                                const description = this.decodeHtmlEntities(fullMeta?.thread_metadata?.description?.text || fullMeta?.description || item.thread_metadata?.description?.text || '');
                                const verified = Boolean((fullMeta?.thread_metadata?.verification === 'VERIFIED') ||
                                    (item.thread_metadata?.verification === 'VERIFIED'));
                                channels.push({
                                    id: inviteCode,
                                    channel_id: inviteCode,
                                    jid: realJid,
                                    newsletter_jid: realJid,
                                    name: channelName,
                                    link: inviteCode
                                        ? `https://whatsapp.com/channel/${inviteCode}`
                                        : `https://whatsapp.com/channel/${realJid.split('@')[0]}`,
                                    role,
                                    can_publish: role === 'owner' || role === 'admin',
                                    subscribers_count,
                                    verified,
                                    description,
                                    pictureUrl,
                                    picture_url: pictureUrl,
                                });
                            }
                        }
                    }
                }
            }
            catch (mexErr) {
                logger.warn({ err: mexErr.message || mexErr }, '[WCA] WMex subscribed list query warning');
            }
            // 2. Query chat list from socket memory for any @newsletter JIDs not caught above
            try {
                const chatStore = sock.store?.chats?.all?.() || [];
                for (const c of chatStore) {
                    const jid = c.id || '';
                    if (jid.endsWith('@newsletter') && !seenIds.has(jid)) {
                        seenIds.add(jid);
                        const realJid = jid;
                        let meta = null;
                        try {
                            if (typeof sock.newsletterMetadata === 'function') {
                                meta = await sock.newsletterMetadata('jid', realJid);
                            }
                        }
                        catch (e) { }
                        let subscribers_count = null;
                        const rawSubs = meta?.thread_metadata?.subscribers_count ?? meta?.subscribers;
                        if (rawSubs !== undefined && rawSubs !== null) {
                            const parsedSubs = parseInt(String(rawSubs), 10);
                            if (!isNaN(parsedSubs))
                                subscribers_count = parsedSubs;
                        }
                        const rawRole = (meta?.viewer_metadata?.role || 'admin').toLowerCase();
                        const role = ['owner', 'admin', 'subscriber', 'guest'].includes(rawRole) ? rawRole : 'admin';
                        const pictureUrl = this.extractPictureUrl(meta);
                        const inviteCode = meta?.thread_metadata?.invite || meta?.invite || realJid.split('@')[0];
                        this.jidCache.set(inviteCode, realJid);
                        this.jidCache.set(realJid, realJid);
                        this.jidCache.set(realJid.split('@')[0], realJid);
                        channels.push({
                            id: inviteCode,
                            channel_id: inviteCode,
                            jid: realJid,
                            newsletter_jid: realJid,
                            name: this.decodeHtmlEntities(meta?.thread_metadata?.name?.text || meta?.name || c.name || 'WhatsApp Channel'),
                            link: inviteCode ? `https://whatsapp.com/channel/${inviteCode}` : `https://whatsapp.com/channel/${realJid.split('@')[0]}`,
                            role,
                            can_publish: role === 'owner' || role === 'admin',
                            subscribers_count,
                            verified: Boolean(meta?.thread_metadata?.verification === 'VERIFIED'),
                            description: this.decodeHtmlEntities(meta?.thread_metadata?.description?.text || ''),
                            pictureUrl,
                            picture_url: pictureUrl,
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
        if (inviteCode && !raw.includes('@newsletter') && !/^\d+@/.test(raw)) {
            try {
                if (typeof sock.newsletterMetadata === 'function') {
                    const meta = await sock.newsletterMetadata('invite', inviteCode);
                    if (meta && meta.id) {
                        const role = (meta.viewer_metadata?.role || 'ADMIN').toLowerCase();
                        const realJid = meta.id.includes('@') ? meta.id : `${meta.id}@newsletter`;
                        const pictureUrl = this.extractPictureUrl(meta);
                        let subscribers_count = null;
                        const rawSubs = meta.thread_metadata?.subscribers_count ?? meta.subscribers;
                        if (rawSubs !== undefined && rawSubs !== null) {
                            const parsed = parseInt(String(rawSubs), 10);
                            if (!isNaN(parsed))
                                subscribers_count = parsed;
                        }
                        this.jidCache.set(inviteCode, realJid);
                        this.jidCache.set(realJid, realJid);
                        this.jidCache.set(realJid.split('@')[0], realJid);
                        logger.info({ id: realJid, name: meta.name, role }, '[WCA] RESOLVE_CHANNEL_BY_INVITE_SUCCESS');
                        return {
                            id: inviteCode,
                            channel_id: inviteCode,
                            jid: realJid,
                            newsletter_jid: realJid,
                            name: this.decodeHtmlEntities(meta.name || meta.thread_metadata?.name?.text || 'WhatsApp Channel'),
                            link: `https://whatsapp.com/channel/${meta.invite || inviteCode}`,
                            role: role,
                            subscribers_count,
                            verified: Boolean(meta.thread_metadata?.verification === 'VERIFIED'),
                            can_publish: role === 'owner' || role === 'admin',
                            description: this.decodeHtmlEntities(meta.thread_metadata?.description?.text || ''),
                            pictureUrl,
                            picture_url: pictureUrl,
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
                    const realJid = meta.id.includes('@') ? meta.id : `${meta.id}@newsletter`;
                    const pictureUrl = this.extractPictureUrl(meta);
                    let subscribers_count = null;
                    const rawSubs = meta.thread_metadata?.subscribers_count ?? meta.subscribers;
                    if (rawSubs !== undefined && rawSubs !== null) {
                        const parsed = parseInt(String(rawSubs), 10);
                        if (!isNaN(parsed))
                            subscribers_count = parsed;
                    }
                    const resolvedInvite = meta.thread_metadata?.invite || meta.invite || realJid.split('@')[0];
                    this.jidCache.set(resolvedInvite, realJid);
                    this.jidCache.set(realJid, realJid);
                    this.jidCache.set(realJid.split('@')[0], realJid);
                    logger.info({ id: realJid, name: meta.name, role }, '[WCA] RESOLVE_CHANNEL_BY_JID_SUCCESS');
                    return {
                        id: resolvedInvite,
                        channel_id: resolvedInvite,
                        jid: realJid,
                        newsletter_jid: realJid,
                        name: this.decodeHtmlEntities(meta.name || meta.thread_metadata?.name?.text || 'WhatsApp Channel'),
                        link: `https://whatsapp.com/channel/${resolvedInvite}`,
                        role: role,
                        subscribers_count,
                        verified: Boolean(meta.thread_metadata?.verification === 'VERIFIED'),
                        can_publish: role === 'owner' || role === 'admin',
                        description: this.decodeHtmlEntities(meta.thread_metadata?.description?.text || ''),
                        pictureUrl,
                        picture_url: pictureUrl,
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
     * Resolves invite codes and links to the real numeric WhatsApp Newsletter JID before sending.
     */
    static async publishToChannel(sock, channelId, messageContent) {
        let target = (channelId || '').trim();
        if (!target) {
            throw new Error('Cannot publish: channelId is required');
        }
        // Strip full URL if present
        const urlMatch = target.match(/(?:whatsapp\.com\/channel\/)?([a-zA-Z0-9_-]{15,35})/);
        let codeOrJid = target;
        if (urlMatch && !target.includes('@newsletter') && !/^\d+@/.test(target)) {
            codeOrJid = urlMatch[1];
        }
        let normalizedJid = codeOrJid.includes('@') ? codeOrJid : `${codeOrJid}@newsletter`;
        // Check if it is a real numeric newsletter JID (e.g. 120363427512887572@newsletter)
        const isNumericNewsletterJid = /^\d+@newsletter$/.test(normalizedJid);
        if (!isNumericNewsletterJid) {
            const prefix = normalizedJid.split('@')[0];
            // 1. Check in-memory jidCache
            if (this.jidCache.has(prefix)) {
                normalizedJid = this.jidCache.get(prefix);
                logger.info({ identifier: prefix, resolvedJid: normalizedJid }, '[WCA] PUBLISH_JID_FROM_CACHE');
            }
            else if (this.jidCache.has(codeOrJid)) {
                normalizedJid = this.jidCache.get(codeOrJid);
                logger.info({ identifier: codeOrJid, resolvedJid: normalizedJid }, '[WCA] PUBLISH_JID_FROM_CACHE');
            }
            else {
                // 2. Resolve invite code or JID to real numeric JID via Baileys newsletterMetadata
                try {
                    logger.info({ codeOrJid: prefix }, '[WCA] PUBLISH_RESOLVING_CHANNEL_IDENTIFIER');
                    if (typeof sock.newsletterMetadata === 'function') {
                        const meta = await sock.newsletterMetadata('invite', prefix);
                        if (meta && meta.id) {
                            const realJid = meta.id.includes('@') ? meta.id : `${meta.id}@newsletter`;
                            this.jidCache.set(prefix, realJid);
                            this.jidCache.set(meta.id, realJid);
                            normalizedJid = realJid;
                            logger.info({ inviteCode: prefix, resolvedJid: realJid }, '[WCA] PUBLISH_INVITE_RESOLVED_SUCCESS');
                        }
                        else {
                            throw new Error(`Invite code '${prefix}' could not be resolved to a WhatsApp Newsletter`);
                        }
                    }
                }
                catch (resolveErr) {
                    logger.error({ err: resolveErr.message, prefix }, '[WCA] Failed to resolve channel identifier to real numeric JID');
                    throw new Error(`Cannot publish: channel identifier '${channelId}' is not a numeric WhatsApp Channel JID and could not be resolved from WhatsApp. Error: ${resolveErr.message}`);
                }
            }
        }
        // Strict validation: must be numeric JID ending in @newsletter
        if (!/^\d+@newsletter$/.test(normalizedJid)) {
            throw new Error(`Cannot publish: invalid WhatsApp Channel JID '${normalizedJid}'. WhatsApp Channels require a valid numeric @newsletter JID.`);
        }
        logger.info({ jid: normalizedJid }, '⚡ Sending message to WhatsApp Newsletter / Channel via socket...');
        const sent = await sock.sendMessage(normalizedJid, messageContent);
        const postId = sent?.key?.id || `wa_msg_${Date.now()}`;
        const publishedAt = new Date().toISOString();
        logger.info({ jid: normalizedJid, postId }, '✅ Message successfully posted to WhatsApp Channel');
        return {
            success: true,
            postId,
            channelId: normalizedJid,
            publishedAt,
        };
    }
}
exports.NewsletterService = NewsletterService;
