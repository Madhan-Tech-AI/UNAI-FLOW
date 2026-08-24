import { WASocket, proto } from '@whiskeysockets/baileys';
import pino from 'pino';

const logger = pino({ level: 'info' });

export interface DiscoveredNewsletter {
  id: string; // e.g. 120363171744447809@newsletter
  name: string;
  link: string;
  role: 'admin' | 'owner' | 'subscriber' | 'guest';
  subscribers_count: number;
  verified: boolean;
  description?: string;
  pictureUrl?: string;
}

export class NewsletterService {
  /**
   * Discovers all WhatsApp Channels/Newsletters where the connected user is owner/admin or subscriber.
   */
  public static async discoverChannels(sock: WASocket): Promise<DiscoveredNewsletter[]> {
    const channels: DiscoveredNewsletter[] = [];
    const seenIds = new Set<string>();

    try {
      // 1. Direct WMex Query for xwa2_newsletter_subscribed_list (Query ID: 6388546374527196)
      try {
        if (typeof (sock as any).query === 'function') {
          const generateMessageTag = (sock as any).generateMessageTag || (() => `${Date.now()}`);
          const mexResult = await (sock as any).query({
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
          const resultChild = mexResult?.content?.find?.((c: any) => c.tag === 'result');
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
                  role: role as any,
                  subscribers_count: parseInt(item.thread_metadata?.subscribers_count || '0', 10),
                  verified: Boolean(item.thread_metadata?.verification === 'VERIFIED'),
                  description: item.thread_metadata?.description?.text || '',
                  pictureUrl: item.thread_metadata?.picture?.direct_path || '',
                });
              }
            }
          }
        }
      } catch (mexErr) {
        logger.warn({ err: mexErr }, '[WCA] WMex subscribed list query warning');
      }

      // 2. Query chat list from socket memory for any @newsletter JIDs
      try {
        const chatStore = (sock as any).store?.chats?.all?.() || [];
        for (const c of chatStore) {
          const jid = c.id || '';
          if (jid.endsWith('@newsletter') && !seenIds.has(jid)) {
            seenIds.add(jid);
            // Try to get full metadata via socket if available
            let meta: any = null;
            try {
              if (typeof (sock as any).newsletterMetadata === 'function') {
                meta = await (sock as any).newsletterMetadata('jid', jid);
              }
            } catch (e) {}

            channels.push({
              id: jid,
              name: meta?.name || meta?.thread_metadata?.name?.text || c.name || 'WhatsApp Channel',
              link: meta?.invite ? `https://whatsapp.com/channel/${meta.invite}` : `https://whatsapp.com/channel/${jid.split('@')[0]}`,
              role: (meta?.viewer_metadata?.role?.toLowerCase() || 'admin') as any,
              subscribers_count: meta?.thread_metadata?.subscribers_count || 0,
              verified: Boolean(meta?.thread_metadata?.verification === 'VERIFIED'),
              description: meta?.thread_metadata?.description?.text || '',
            });
          }
        }
      } catch (storeErr) {
        logger.debug({ err: storeErr }, '[WCA] Chat store scan note');
      }

      logger.info({ count: channels.length }, '[WCA] CHANNELS_DISCOVERED');
      return channels;
    } catch (err) {
      logger.error({ err }, '[WCA] Error during channel discovery');
      return channels;
    }
  }

  /**
   * Fetches metadata for a specific WhatsApp Newsletter / Channel.
   */
  public static async getChannelMetadata(sock: WASocket, channelId: string): Promise<DiscoveredNewsletter | null> {
    try {
      const normalizedJid = channelId.includes('@') ? channelId : `${channelId}@newsletter`;
      if (typeof (sock as any).newsletterMetadata === 'function') {
        const metadata = await (sock as any).newsletterMetadata('jid', normalizedJid);
        if (metadata) {
          return {
            id: metadata.id || normalizedJid,
            name: metadata.name || metadata.thread_metadata?.name?.text || 'WhatsApp Channel',
            link: metadata.invite ? `https://whatsapp.com/channel/${metadata.invite}` : `https://whatsapp.com/channel/${normalizedJid.split('@')[0]}`,
            role: metadata.viewer_metadata?.role?.toLowerCase() || 'admin',
            subscribers_count: metadata.thread_metadata?.subscribers_count || 0,
            verified: metadata.thread_metadata?.verification === 'VERIFIED',
            description: metadata.thread_metadata?.description?.text || '',
          };
        }
      }
    } catch (err) {
      logger.warn({ err, channelId }, 'Failed to fetch channel metadata via socket');
    }

    return {
      id: channelId.includes('@') ? channelId : `${channelId}@newsletter`,
      name: 'WhatsApp Channel',
      link: `https://whatsapp.com/channel/${channelId.split('@')[0]}`,
      role: 'admin',
      subscribers_count: 0,
      verified: false,
    };
  }

  /**
   * Publishes message to a WhatsApp Channel (@newsletter JID) directly via WebSocket protocol.
   */
  public static async publishToChannel(
    sock: WASocket,
    channelId: string,
    messageContent: proto.IMessage | any
  ): Promise<{ success: boolean; postId: string; channelId: string; publishedAt: string }> {
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
