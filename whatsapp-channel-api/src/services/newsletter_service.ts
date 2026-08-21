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
   * Discovers all WhatsApp Channels/Newsletters where the connected user is owner/admin or member.
   */
  public static async discoverChannels(sock: WASocket): Promise<DiscoveredNewsletter[]> {
    const channels: DiscoveredNewsletter[] = [];
    const seenIds = new Set<string>();

    try {
      // 1. Fetch user's subscribed newsletters if supported by Baileys
      if (typeof (sock as any).newsletterSubscribedList === 'function') {
        try {
          const res = await (sock as any).newsletterSubscribedList();
          if (Array.isArray(res)) {
            for (const item of res) {
              const jid = item.id || item.jid;
              if (jid && !seenIds.has(jid)) {
                seenIds.add(jid);
                channels.push({
                  id: jid,
                  name: item.name || item.thread_metadata?.name?.text || 'WhatsApp Channel',
                  link: item.invite ? `https://whatsapp.com/channel/${item.invite}` : `https://whatsapp.com/channel/${jid.split('@')[0]}`,
                  role: item.viewer_metadata?.role?.toLowerCase() || 'admin',
                  subscribers_count: item.thread_metadata?.subscribers_count || 0,
                  verified: Boolean(item.thread_metadata?.verification === 'VERIFIED'),
                  description: item.thread_metadata?.description?.text || '',
                  pictureUrl: item.thread_metadata?.picture?.direct_path || '',
                });
              }
            }
          }
        } catch (subErr) {
          logger.warn({ err: subErr }, 'newsletterSubscribedList returned error, falling back to chat store');
        }
      }

      // 2. Query chat list from socket memory for all @newsletter JIDs
      try {
        const chats = await (sock as any).groupFetchAllParticipating?.() || {};
        // Also inspect stored newsletter messages/chats
        const chatStore = (sock as any).store?.chats?.all?.() || [];
        for (const c of chatStore) {
          const jid = c.id || '';
          if (jid.endsWith('@newsletter') && !seenIds.has(jid)) {
            seenIds.add(jid);
            channels.push({
              id: jid,
              name: c.name || 'WhatsApp Channel',
              link: `https://whatsapp.com/channel/${jid.split('@')[0]}`,
              role: 'admin',
              subscribers_count: 0,
              verified: false,
            });
          }
        }
      } catch (storeErr) {
        logger.debug({ err: storeErr }, 'store inspection note');
      }

      return channels;
    } catch (err) {
      logger.error({ err }, 'Error during channel discovery');
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
