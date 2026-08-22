import { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Copy, Sparkles, Heart, MessageSquare, Edit3, Check, AtSign, Share2, ThumbsUp, Loader2, Send, Camera, MoreHorizontal, Inbox, MessageCircle } from 'lucide-react';
import { fetchApi } from '../lib/apiClient';

function Facebook({ size = 18, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
    </svg>
  );
}

export default function PreviewVariants() {
  const navigate = useNavigate();
  const location = useLocation();
  const { automationId, variants, mediaUrl } = location.state || {};
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState('');

  const [localVariants, setLocalVariants] = useState<any[]>(variants || []);
  const [editingPlatform, setEditingPlatform] = useState<string | null>(null);
  const [copiedPlatform, setCopiedPlatform] = useState<string | null>(null);

  const getVariant = (platform: string) => {
    return localVariants.find((v: any) => v.platform === platform);
  };

  const updateVariantText = (platform: string, newText: string) => {
    setLocalVariants(prev =>
      prev.map(v => v.platform === platform ? { ...v, generated_text: newText, char_count: newText.length } : v)
    );
  };

  const handleCopy = (platform: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedPlatform(platform);
    setTimeout(() => setCopiedPlatform(null), 2000);
  };

  const handlePublish = async () => {
    setPublishing(true);
    setError('');
    try {
      let response = null;
      if (automationId) {
        response = await fetchApi(`/automations/${automationId}/publish`, {
          method: 'POST'
        });
      }
      
      // Show summary of what happened
      if (response && response.results) {
        const realPosts = response.results.filter((r: any) => r.status === 'success');
        const failedPosts = response.results.filter((r: any) => r.status === 'failed');
        
        let summary = '';
        if (realPosts.length > 0) {
          summary += `✅ Published live: ${realPosts.map((r: any) => r.platform).join(', ')}\n`;
        }
        if (failedPosts.length > 0) {
          summary += `❌ Publishing Failed for: ${failedPosts.map((r: any) => `${r.platform}: ${r.error}`).join('\n')}\n`;
          setError(summary);
        }
        
        if (summary) {
          console.log("Publish Results Summary:\n", summary);
        }
      }
      
      navigate('/history');
    } catch (err: any) {
      setError(err.message || 'Publishing failed. Please try again.');
    } finally {
      setPublishing(false);
    }
  };

  if (!localVariants || localVariants.length === 0) {
    return (
      <div className="flex-col gap-6 items-center justify-center py-16 text-center">
        <Inbox size={48} className="text-muted" />
        <h2 className="text-2xl font-bold text-main">No Content Variants to Preview</h2>
        <p className="text-secondary text-sm max-w-md">
          Generate campaign content first on the New Automation page to review AI platform adaptations.
        </p>
        <Link to="/automations/new" className="btn-primary">
          <Sparkles size={16} />
          <span>Create New Campaign</span>
        </Link>
      </div>
    );
  }

  const instagramVariant = getVariant('instagram');
  const twitterVariant = getVariant('twitter');
  const facebookVariant = getVariant('facebook');
  const whatsappVariant = getVariant('whatsapp');

  return (
    <div className="flex-col gap-8">
      {/* Top Banner & Action Header */}
      <div className="flex justify-between items-center flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/automations/new')}
            className="btn-secondary flex items-center gap-2"
            style={{ padding: '0.6rem 0.85rem' }}
          >
            <ArrowLeft size={18} />
            <span>Back to Draft</span>
          </button>
          <div>
            <h1 className="text-3xl font-extrabold" style={{ color: 'var(--text-main)' }}>
              Review AI Channel Variants
            </h1>
            <p className="text-secondary mt-1 text-sm">
              Review and edit native formats generated for each platform before live publishing.
            </p>
          </div>
        </div>

        <button
          onClick={handlePublish}
          disabled={publishing}
          className="btn-primary"
          style={{ padding: '0.75rem 1.5rem', fontSize: '1rem', borderRadius: '14px' }}
        >
          {publishing ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
          <span>{publishing ? 'Publishing to Channels...' : '🚀 Publish to All Platforms'}</span>
        </button>
      </div>

      {error && (
        <div className="text-sm font-medium" style={{ padding: '1rem', backgroundColor: '#fee2e2', color: '#991b1b', borderRadius: '12px', border: '1px solid #fecaca' }}>
          {error}
        </div>
      )}

      {/* Platform Native Preview Mockup Grid */}
      <div className="flex gap-6 flex-wrap">
        {/* 1. Instagram Native Mockup Card */}
        {instagramVariant && (
          <div className="card flex-col gap-4 flex-1" style={{ minWidth: '320px', borderRadius: '20px' }}>
            <div className="flex justify-between items-center pb-3" style={{ borderBottom: '1px solid var(--border)' }}>
              <div className="flex items-center gap-2">
                <span style={{ color: '#E1306C', backgroundColor: '#fee2e2', padding: '6px', borderRadius: '8px' }}>
                  <Camera size={18} />
                </span>
                <h3 className="font-bold text-base text-main">Instagram Preview</h3>
              </div>
              <span className="chip chip-default text-xs">{instagramVariant.char_count} / 2200 chars</span>
            </div>

            {/* Instagram Mockup UI */}
            <div
              style={{
                backgroundColor: '#ffffff',
                borderRadius: '16px',
                border: '1px solid #e2e8f0',
                overflow: 'hidden',
                boxShadow: 'var(--shadow-sm)'
              }}
            >
              {/* Profile Header */}
              <div className="flex items-center justify-between p-3" style={{ borderBottom: '1px solid #f1f5f9' }}>
                <div className="flex items-center gap-2.5">
                  <div
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      background: 'linear-gradient(135deg, #E1306C, #F77737)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'white',
                      fontWeight: 700,
                      fontSize: '0.75rem'
                    }}
                  >
                    UF
                  </div>
                  <div>
                    <p className="font-bold text-xs text-main">Your Channel</p>
                    <p className="text-xs text-muted" style={{ fontSize: '0.65rem' }}>AI Preview</p>
                  </div>
                </div>
                <MoreHorizontal size={16} className="text-secondary" />
              </div>

              {/* Image Frame Placeholder or Actual Image / Video */}
              {mediaUrl ? (
                <div style={{ height: '180px', width: '100%', overflow: 'hidden', backgroundColor: '#000000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {mediaUrl.startsWith('data:video') || mediaUrl.includes('.mp4') || mediaUrl.includes('.mov') ? (
                    <video src={mediaUrl} controls style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                  ) : (
                    <img src={mediaUrl} alt="Campaign Media" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  )}
                </div>
              ) : (
                <div
                  style={{
                    height: '180px',
                    background: 'linear-gradient(135deg, #1d4ed8 0%, #3b82f6 50%, #8b5cf6 100%)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'white',
                    padding: '1rem',
                    textAlign: 'center'
                  }}
                >
                  <Sparkles size={32} />
                  <span className="font-extrabold text-sm mt-2">UNAI Flow Multi-Channel</span>
                  <span className="text-xs opacity-85 mt-0.5">Automated Native Content</span>
                </div>
              )}

              {/* Action Icons Bar */}
              <div className="flex justify-between items-center p-3 text-main">
                <div className="flex items-center gap-3">
                  <Heart size={18} />
                  <MessageSquare size={18} />
                  <Send size={18} />
                </div>
                <BookmarkIcon size={18} />
              </div>

              {/* Caption Content Area */}
              <div className="px-3 pb-4">
                {editingPlatform === 'instagram' ? (
                  <textarea
                    className="input text-xs"
                    rows={6}
                    value={instagramVariant.generated_text}
                    onChange={(e) => updateVariantText('instagram', e.target.value)}
                  />
                ) : (
                  <div className="text-xs text-main" style={{ whiteSpace: 'pre-wrap', lineHeight: '1.5' }}>
                    {instagramVariant.generated_text}
                  </div>
                )}
              </div>
            </div>

            {/* Card Action Controls */}
            <div className="flex gap-2 mt-2">
              <button
                className="btn-secondary flex-1"
                onClick={() => setEditingPlatform(editingPlatform === 'instagram' ? null : 'instagram')}
              >
                <Edit3 size={15} />
                <span>{editingPlatform === 'instagram' ? 'Done Editing' : 'Edit Caption'}</span>
              </button>
              <button
                className="btn-secondary"
                onClick={() => handleCopy('instagram', instagramVariant.generated_text)}
                title="Copy text"
              >
                {copiedPlatform === 'instagram' ? <Check size={16} className="text-success" /> : <Copy size={16} />}
              </button>
            </div>
          </div>
        )}

        {/* 2. Twitter / X Native Mockup Card */}
        {twitterVariant && (
          <div className="card flex-col gap-4 flex-1" style={{ minWidth: '320px', borderRadius: '20px' }}>
            <div className="flex justify-between items-center pb-3" style={{ borderBottom: '1px solid var(--border)' }}>
              <div className="flex items-center gap-2">
                <span style={{ color: '#0f172a', backgroundColor: '#e2e8f0', padding: '6px', borderRadius: '8px' }}>
                  <AtSign size={18} />
                </span>
                <h3 className="font-bold text-base text-main">Twitter / X Preview</h3>
              </div>
              <span className="chip chip-default text-xs">{twitterVariant.char_count} / 280 chars</span>
            </div>

            {/* Twitter / X Mockup UI */}
            <div
              style={{
                backgroundColor: '#ffffff',
                borderRadius: '16px',
                border: '1px solid #e2e8f0',
                padding: '1rem',
                boxShadow: 'var(--shadow-sm)'
              }}
            >
              <div className="flex gap-3">
                <div
                  style={{
                    width: '38px',
                    height: '38px',
                    borderRadius: '50%',
                    backgroundColor: '#0f172a',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'white',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    flexShrink: 0
                  }}
                >
                  X
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-bold text-xs text-main">Your Channel</span>
                    <CheckCircle2 size={13} className="text-primary" />
                    <span className="text-xs text-muted">Preview</span>
                  </div>

                  {editingPlatform === 'twitter' ? (
                    <textarea
                      className="input text-xs mt-2"
                      rows={5}
                      value={twitterVariant.generated_text}
                      onChange={(e) => updateVariantText('twitter', e.target.value)}
                    />
                  ) : (
                    <p className="text-xs text-main mt-2" style={{ whiteSpace: 'pre-wrap', lineHeight: '1.5' }}>
                      {twitterVariant.generated_text}
                    </p>
                  )}

                  {/* Tweet Interactions */}
                  <div className="flex justify-between items-center mt-4 text-secondary" style={{ fontSize: '0.75rem', maxWidth: '240px' }}>
                    <span className="flex items-center gap-1"><MessageSquare size={14} /></span>
                    <span className="flex items-center gap-1"><RepeatIcon size={14} /></span>
                    <span className="flex items-center gap-1"><Heart size={14} /></span>
                    <span className="flex items-center gap-1"><Share2 size={14} /></span>
                  </div>
                </div>
              </div>
            </div>

            {/* Card Action Controls */}
            <div className="flex gap-2 mt-auto">
              <button
                className="btn-secondary flex-1"
                onClick={() => setEditingPlatform(editingPlatform === 'twitter' ? null : 'twitter')}
              >
                <Edit3 size={15} />
                <span>{editingPlatform === 'twitter' ? 'Done Editing' : 'Edit Tweet'}</span>
              </button>
              <button
                className="btn-secondary"
                onClick={() => handleCopy('twitter', twitterVariant.generated_text)}
                title="Copy text"
              >
                {copiedPlatform === 'twitter' ? <Check size={16} className="text-success" /> : <Copy size={16} />}
              </button>
            </div>
          </div>
        )}



        {/* 4. Facebook Native Mockup Card */}
        {facebookVariant && (
          <div className="card flex-col gap-4 flex-1" style={{ minWidth: '320px', borderRadius: '20px' }}>
            <div className="flex justify-between items-center pb-3" style={{ borderBottom: '1px solid var(--border)' }}>
              <div className="flex items-center gap-2">
                <span style={{ color: '#1877F2', backgroundColor: '#dbeafe', padding: '6px', borderRadius: '8px' }}>
                  <Facebook size={18} />
                </span>
                <h3 className="font-bold text-base text-main">Facebook Preview</h3>
              </div>
              <span className="chip chip-default text-xs">{facebookVariant.char_count} / 63206 chars</span>
            </div>

            {/* Facebook Feed Post Mockup UI */}
            <div
              style={{
                backgroundColor: '#ffffff',
                borderRadius: '16px',
                border: '1px solid #e2e8f0',
                overflow: 'hidden',
                boxShadow: 'var(--shadow-sm)'
              }}
            >
              {/* Profile Header */}
              <div className="flex items-center justify-between p-3" style={{ borderBottom: '1px solid #f1f5f9' }}>
                <div className="flex items-center gap-2.5">
                  <div
                    style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: '50%',
                      background: 'linear-gradient(135deg, #1877F2, #42a5f5)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'white',
                      fontWeight: 700,
                      fontSize: '0.75rem'
                    }}
                  >
                    FB
                  </div>
                  <div>
                    <p className="font-bold text-xs text-main">Your Page</p>
                    <p className="text-xs text-muted" style={{ fontSize: '0.65rem' }}>AI Preview · 🌐</p>
                  </div>
                </div>
                <MoreHorizontal size={16} className="text-secondary" />
              </div>

              {/* Post Content Area */}
              <div className="px-3 py-3">
                {editingPlatform === 'facebook' ? (
                  <textarea
                    className="input text-xs"
                    rows={6}
                    value={facebookVariant.generated_text}
                    onChange={(e) => updateVariantText('facebook', e.target.value)}
                  />
                ) : (
                  <div className="text-xs text-main" style={{ whiteSpace: 'pre-wrap', lineHeight: '1.5' }}>
                    {facebookVariant.generated_text}
                  </div>
                )}
              </div>

              {/* Facebook Media Attachment Frame */}
              {mediaUrl ? (
                <div style={{ maxHeight: '220px', width: '100%', overflow: 'hidden', backgroundColor: '#000000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {mediaUrl.startsWith('data:video') || mediaUrl.includes('.mp4') || mediaUrl.includes('.mov') ? (
                    <video src={mediaUrl} controls style={{ width: '100%', maxHeight: '220px', objectFit: 'contain' }} />
                  ) : (
                    <img src={mediaUrl} alt="Facebook Post Media" style={{ width: '100%', maxHeight: '220px', objectFit: 'cover' }} />
                  )}
                </div>
              ) : null}

              {/* Engagement Stats Bar */}
              <div className="flex items-center justify-between px-3 py-2" style={{ borderTop: '1px solid #f1f5f9', borderBottom: '1px solid #f1f5f9' }}>
                <span className="text-xs text-muted flex items-center gap-1">
                  <span style={{ color: '#1877F2' }}>👍</span> Preview
                </span>
                <span className="text-xs text-muted">0 Comments · 0 Shares</span>
              </div>

              {/* Action Buttons Bar */}
              <div className="flex justify-around items-center p-2 text-secondary" style={{ fontSize: '0.75rem' }}>
                <span className="flex items-center gap-1.5 cursor-pointer" style={{ padding: '0.4rem 0.75rem', borderRadius: '6px' }}>
                  <ThumbsUp size={15} /> Like
                </span>
                <span className="flex items-center gap-1.5 cursor-pointer" style={{ padding: '0.4rem 0.75rem', borderRadius: '6px' }}>
                  <MessageSquare size={15} /> Comment
                </span>
                <span className="flex items-center gap-1.5 cursor-pointer" style={{ padding: '0.4rem 0.75rem', borderRadius: '6px' }}>
                  <Share2 size={15} /> Share
                </span>
              </div>
            </div>

            {/* Card Action Controls */}
            <div className="flex gap-2 mt-auto">
              <button
                className="btn-secondary flex-1"
                onClick={() => setEditingPlatform(editingPlatform === 'facebook' ? null : 'facebook')}
              >
                <Edit3 size={15} />
                <span>{editingPlatform === 'facebook' ? 'Done Editing' : 'Edit Post'}</span>
              </button>
              <button
                className="btn-secondary"
                onClick={() => handleCopy('facebook', facebookVariant.generated_text)}
                title="Copy text"
              >
                {copiedPlatform === 'facebook' ? <Check size={16} className="text-success" /> : <Copy size={16} />}
              </button>
            </div>
          </div>
        )}

        {/* 4. WhatsApp Channel Native Mockup Card */}
        {whatsappVariant && (
          <div className="card flex-col gap-4 flex-1" style={{ minWidth: '320px', borderRadius: '20px' }}>
            <div className="flex justify-between items-center pb-3" style={{ borderBottom: '1px solid var(--border)' }}>
              <div className="flex items-center gap-2">
                <span style={{ color: '#25D366', backgroundColor: '#dcfce7', padding: '6px', borderRadius: '8px' }}>
                  <MessageCircle size={18} />
                </span>
                <h3 className="font-bold text-base text-main">WhatsApp Channel</h3>
              </div>
              <span className="chip chip-default text-xs">{whatsappVariant.char_count} / 4096 chars</span>
            </div>

            {/* WhatsApp Mockup UI */}
            <div
              style={{
                backgroundColor: '#e5ddd5',
                borderRadius: '16px',
                border: '1px solid #e2e8f0',
                overflow: 'hidden',
                boxShadow: 'var(--shadow-sm)'
              }}
            >
              {/* Channel Header */}
              <div className="flex items-center gap-2.5 p-3" style={{ backgroundColor: '#075E54', color: 'white' }}>
                <div
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    background: 'linear-gradient(135deg, #25D366, #128C7E)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'white',
                    fontWeight: 700,
                    fontSize: '0.75rem'
                  }}
                >
                  📢
                </div>
                <div>
                  <p className="font-bold text-xs">Your Channel</p>
                  <p className="text-xs" style={{ opacity: 0.75, fontSize: '0.6rem' }}>WhatsApp Channel · AI Preview</p>
                </div>
              </div>

              {/* Media (if any) */}
              {mediaUrl && (
                <div style={{ padding: '8px' }}>
                  <div style={{ borderRadius: '8px', overflow: 'hidden', maxHeight: '150px' }}>
                    {mediaUrl.startsWith('data:video') || mediaUrl.includes('.mp4') || mediaUrl.includes('.mov') ? (
                      <video src={mediaUrl} controls style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                    ) : (
                      <img src={mediaUrl} alt="Campaign Media" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    )}
                  </div>
                </div>
              )}

              {/* Message Bubble */}
              <div style={{ padding: '8px 12px 12px' }}>
                <div
                  style={{
                    backgroundColor: '#dcf8c6',
                    borderRadius: '0 8px 8px 8px',
                    padding: '10px 12px',
                    maxWidth: '100%',
                    boxShadow: '0 1px 1px rgba(0,0,0,0.1)'
                  }}
                >
                  {editingPlatform === 'whatsapp' ? (
                    <textarea
                      className="input text-xs"
                      rows={6}
                      value={whatsappVariant.generated_text}
                      onChange={(e) => updateVariantText('whatsapp', e.target.value)}
                      style={{ backgroundColor: 'transparent', border: '1px solid #25D366' }}
                    />
                  ) : (
                    <div className="text-xs text-main" style={{ whiteSpace: 'pre-wrap', lineHeight: '1.5' }}>
                      {whatsappVariant.generated_text}
                    </div>
                  )}
                  <div className="flex justify-end mt-1">
                    <span className="text-xs" style={{ color: '#667781', fontSize: '0.6rem' }}>AI Preview ✓✓</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Card Action Controls */}
            <div className="flex gap-2 mt-auto">
              <button
                className="btn-secondary flex-1"
                onClick={() => setEditingPlatform(editingPlatform === 'whatsapp' ? null : 'whatsapp')}
              >
                <Edit3 size={15} />
                <span>{editingPlatform === 'whatsapp' ? 'Done Editing' : 'Edit Post'}</span>
              </button>
              <button
                className="btn-secondary"
                onClick={() => handleCopy('whatsapp', whatsappVariant.generated_text)}
                title="Copy text"
              >
                {copiedPlatform === 'whatsapp' ? <Check size={16} className="text-success" /> : <Copy size={16} />}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function BookmarkIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
    </svg>
  );
}

function RepeatIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="17 1 21 5 17 9"></polyline>
      <path d="M3 11V9a4 4 0 0 1 4-4h14"></path>
      <polyline points="7 23 3 19 7 15"></polyline>
      <path d="M21 13v2a4 4 0 0 1-4 4H3"></path>
    </svg>
  );
}
