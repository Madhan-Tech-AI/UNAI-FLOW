import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, AtSign, MessageCircle, Sparkles, Loader2, Link2, UploadCloud, Layers, Zap, Info } from 'lucide-react';
import { fetchApi } from '../lib/apiClient';
import { supabase } from '../lib/supabaseClient';

export default function NewAutomation() {
  const navigate = useNavigate();
  const [content, setContent] = useState('');
  const [campaignName, setCampaignName] = useState('');
  const [tone, setTone] = useState('professional');
  const [ctaLink, setCtaLink] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const [platforms, setPlatforms] = useState({
    instagram: true,
    twitter: true,
    whatsapp: true
  });

  const tones = [
    { id: 'professional', label: 'Professional', icon: '💼', desc: 'Authoritative, polished, B2B' },
    { id: 'casual', label: 'Casual', icon: '😊', desc: 'Friendly, conversational' },
    { id: 'promotional', label: 'Promotional', icon: '🚀', desc: 'High energy, CTA focused' },
    { id: 'storytelling', label: 'Storytelling', icon: '📖', desc: 'Engaging, narrative driven' }
  ];

  const uploadToSupabase = async (file: File): Promise<string> => {
    const fileExt = file.name.split('.').pop();
    const fileName = `${Math.random().toString(36).substring(2)}.${fileExt}`;
    const filePath = `uploads/${fileName}`;

    const { error } = await supabase.storage
      .from('media')
      .upload(filePath, file);

    if (error) {
      throw error;
    }

    const { data: { publicUrl } } = supabase.storage
      .from('media')
      .getPublicUrl(filePath);

    return publicUrl;
  };

  const getBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = error => reject(error);
    });
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const targetPlatforms = Object.keys(platforms).filter((key) => platforms[key as keyof typeof platforms]);
    
    if (targetPlatforms.length === 0) {
      setError('Please select at least one target platform.');
      setLoading(false);
      return;
    }

    try {
      let mediaBase64 = null;
      let mediaUrl = null;
      if (selectedFile) {
        try {
          mediaBase64 = await getBase64(selectedFile);
          mediaUrl = await uploadToSupabase(selectedFile);
        } catch (err) {
          console.error("Failed to upload media to Supabase, falling back to local base64", err);
          mediaUrl = mediaBase64;
        }
      }

      const automation = await fetchApi('/automations', {
        method: 'POST',
        body: JSON.stringify({
          campaign_name: campaignName || 'New Campaign Flow',
          raw_content: content,
          tone,
          cta_link: ctaLink || null,
          target_platforms: targetPlatforms,
          schedule_type: 'now',
          media_url: mediaUrl
        })
      });

      const response = await fetchApi(`/automations/${automation.id}/generate`, {
        method: 'POST'
      });

      if (response && response.variants) {
        navigate('/automations/preview', { 
          state: { 
            automationId: automation.id, 
            variants: response.variants,
            mediaUrl: mediaBase64 || mediaUrl
          } 
        });
      } else {
        throw new Error("No content variants returned from API.");
      }
    } catch (err: any) {
      setError(err.message || 'Failed to generate automation variants. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const togglePlatform = (key: keyof typeof platforms) => {
    setPlatforms(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const addPromptHelper = (phrase: string) => {
    setContent(prev => prev ? `${prev} ${phrase}` : phrase);
  };

  return (
    <div className="flex-col gap-8">
      {/* Top Header & Progress Stepper */}
      <div className="flex justify-between items-center flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-extrabold flex items-center gap-3" style={{ color: 'var(--text-main)' }}>
            New AI Campaign Flow <Sparkles size={24} className="text-primary" />
          </h1>
          <p className="text-secondary mt-1 text-sm">
            Write your core message once — Gemini AI optimizes native captions & formats for each platform.
          </p>
        </div>

        {/* Step Indicator */}
        <div className="flex items-center gap-2" style={{ backgroundColor: '#ffffff', padding: '0.5rem 1rem', borderRadius: '12px', border: '1px solid var(--border)' }}>
          <span className="chip chip-info" style={{ fontWeight: 700 }}>Step 1 of 2</span>
          <span className="text-xs font-semibold text-main">Draft & Target Selection</span>
        </div>
      </div>

      {error && (
        <div className="text-sm font-medium" style={{ padding: '1rem', backgroundColor: '#fee2e2', color: '#991b1b', borderRadius: '12px', border: '1px solid #fecaca' }}>
          {error}
        </div>
      )}

      {/* Main Grid Layout: Balanced 2-Column Structure */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 340px', gap: '1.5rem', alignItems: 'start' }}>
        
        {/* Left Column: Form Controls */}
        <div className="card flex-col gap-6" style={{ width: '100%' }}>
          <form onSubmit={handleGenerate} className="flex-col gap-6">
            {/* Campaign Name */}
            <div>
              <label className="label" htmlFor="campaignName">Campaign Title (Optional)</label>
              <input
                id="campaignName"
                className="input"
                placeholder="e.g. Q3 AI Feature Announcement"
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
              />
            </div>

            {/* Core Message Textarea */}
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="label mb-0" htmlFor="content">Raw Content / Core Message *</label>
                <span className="text-xs text-muted font-medium">{content.length} characters</span>
              </div>
              <textarea
                id="content"
                className="input"
                rows={6}
                placeholder="Type or paste your main message, product announcement, or key points here..."
                value={content}
                onChange={(e) => setContent(e.target.value)}
                required
                style={{ resize: 'vertical', lineHeight: '1.6' }}
              />

              {/* AI Assistant Quick Enhancers */}
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <span className="text-xs font-semibold text-secondary flex items-center gap-1">
                  <Zap size={13} className="text-primary" /> Quick Enhancers:
                </span>
                <button type="button" onClick={() => addPromptHelper('✨ Make it engaging and punchy!')} className="btn-ghost text-xs" style={{ padding: '0.25rem 0.6rem', backgroundColor: '#f1f5f9', borderRadius: '6px' }}>
                  ✨ Catchy
                </button>
                <button type="button" onClick={() => addPromptHelper('⚡ Summarize into key bullet points.')} className="btn-ghost text-xs" style={{ padding: '0.25rem 0.6rem', backgroundColor: '#f1f5f9', borderRadius: '6px' }}>
                  ⚡ Bullet Points
                </button>
                <button type="button" onClick={() => addPromptHelper('👉 Click link in bio to learn more!')} className="btn-ghost text-xs" style={{ padding: '0.25rem 0.6rem', backgroundColor: '#f1f5f9', borderRadius: '6px' }}>
                  🎯 Add CTA
                </button>
              </div>
            </div>

            {/* Brand Tone Selector Pills - Balanced 2x2 Grid Layout */}
            <div>
              <label className="label mb-2">Brand Voice & Tone</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.75rem' }}>
                {tones.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTone(t.id)}
                    className="flex items-center gap-3 p-3 text-left"
                    style={{
                      borderRadius: '12px',
                      border: tone === t.id ? '2px solid var(--primary)' : '1px solid var(--border)',
                      backgroundColor: tone === t.id ? 'var(--primary-light)' : '#ffffff',
                      color: tone === t.id ? 'var(--primary)' : 'var(--text-main)',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      width: '100%'
                    }}
                  >
                    <span style={{ fontSize: '1.25rem', lineHeight: 1 }}>{t.icon}</span>
                    <div className="truncate">
                      <p className="text-xs font-bold truncate">{t.label}</p>
                      <p className="text-xs text-muted font-normal truncate" style={{ fontSize: '0.7rem' }}>{t.desc}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* CTA Link & Media Drag-and-Drop - Matching Grid Heights */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', alignItems: 'end' }}>
              <div>
                <label className="label" htmlFor="ctaLink">Destination / CTA Link</label>
                <div style={{ position: 'relative' }}>
                  <Link2 size={16} style={{ position: 'absolute', left: '12px', top: '14px', color: '#94a3b8' }} />
                  <input
                    id="ctaLink"
                    type="url"
                    className="input"
                    placeholder="https://yourwebsite.com/launch"
                    value={ctaLink}
                    onChange={(e) => setCtaLink(e.target.value)}
                    style={{ paddingLeft: '2.4rem', height: '44px' }}
                  />
                </div>
              </div>

              <div>
                <label className="label" htmlFor="media">Media Attachment (Optional)</label>
                <div
                  style={{
                    height: '44px',
                    border: '1px dashed var(--border)',
                    borderRadius: '12px',
                    padding: '0 1rem',
                    backgroundColor: '#f8fafc',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    cursor: 'pointer',
                    transition: 'border-color 0.2s'
                  }}
                  onClick={() => document.getElementById('media-upload')?.click()}
                >
                  <UploadCloud size={18} className="text-primary flex-shrink-0" />
                  <span className="text-xs text-secondary truncate">
                    {selectedFile ? selectedFile.name : 'Upload Image or Video'}
                  </span>
                  <input
                    type="file"
                    id="media-upload"
                    className="hidden"
                    accept="image/*,video/*"
                    style={{ display: 'none' }}
                    onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                  />
                </div>
              </div>
            </div>

            {/* Submit Action Button */}
            <div className="pt-4" style={{ borderTop: '1px solid var(--border)' }}>
              <button
                type="submit"
                className="btn-primary w-full flex items-center justify-center gap-2"
                style={{ height: '48px', fontSize: '0.95rem', borderRadius: '12px' }}
                disabled={loading}
              >
                {loading ? <Loader2 size={20} className="animate-spin" /> : <Sparkles size={20} />}
                <span>{loading ? 'Generating AI Channel Previews...' : 'Generate Previews ✨'}</span>
              </button>
            </div>
          </form>
        </div>

        {/* Right Column: Platform Selectors & Engine Specs */}
        <div className="flex-col gap-5" style={{ width: '100%' }}>
          {/* Target Platforms Selection */}
          <div className="card flex-col gap-4">
            <div>
              <h3 className="font-bold text-base text-main flex items-center gap-2">
                <Layers size={18} className="text-primary" /> Target Channels
              </h3>
              <p className="text-xs text-secondary mt-1">Select channels to receive AI formatted content</p>
            </div>

            <div className="flex-col gap-3">
              {/* Instagram Card */}
              <div
                onClick={() => togglePlatform('instagram')}
                className="flex items-center justify-between p-3.5 cursor-pointer"
                style={{
                  borderRadius: '12px',
                  border: platforms.instagram ? '2px solid #E1306C' : '1px solid var(--border)',
                  backgroundColor: platforms.instagram ? '#fff5f7' : '#ffffff',
                  transition: 'all 0.2s'
                }}
              >
                <div className="flex items-center gap-3">
                  <span style={{ color: '#E1306C', backgroundColor: '#fee2e2', padding: '8px', borderRadius: '10px' }}>
                    <Camera size={18} />
                  </span>
                  <div>
                    <h4 className="font-bold text-sm text-main">Instagram</h4>
                    <p className="text-xs text-secondary">Hashtags, Bio Link & Captions</p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={platforms.instagram}
                  onChange={() => togglePlatform('instagram')}
                  onClick={(e) => e.stopPropagation()}
                  style={{ width: '1.2rem', height: '1.2rem', accentColor: '#E1306C', cursor: 'pointer' }}
                />
              </div>

              {/* Twitter / X Card */}
              <div
                onClick={() => togglePlatform('twitter')}
                className="flex items-center justify-between p-3.5 cursor-pointer"
                style={{
                  borderRadius: '12px',
                  border: platforms.twitter ? '2px solid #0f172a' : '1px solid var(--border)',
                  backgroundColor: platforms.twitter ? '#f8fafc' : '#ffffff',
                  transition: 'all 0.2s'
                }}
              >
                <div className="flex items-center gap-3">
                  <span style={{ color: '#0f172a', backgroundColor: '#e2e8f0', padding: '8px', borderRadius: '10px' }}>
                    <AtSign size={18} />
                  </span>
                  <div>
                    <h4 className="font-bold text-sm text-main">Twitter / X</h4>
                    <p className="text-xs text-secondary">280 Chars & Thread Splitter</p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={platforms.twitter}
                  onChange={() => togglePlatform('twitter')}
                  onClick={(e) => e.stopPropagation()}
                  style={{ width: '1.2rem', height: '1.2rem', accentColor: '#0f172a', cursor: 'pointer' }}
                />
              </div>

              {/* WhatsApp Card */}
              <div
                onClick={() => togglePlatform('whatsapp')}
                className="flex items-center justify-between p-3.5 cursor-pointer"
                style={{
                  borderRadius: '12px',
                  border: platforms.whatsapp ? '2px solid #25D366' : '1px solid var(--border)',
                  backgroundColor: platforms.whatsapp ? '#f0fdf4' : '#ffffff',
                  transition: 'all 0.2s'
                }}
              >
                <div className="flex items-center gap-3">
                  <span style={{ color: '#25D366', backgroundColor: '#dcfce7', padding: '8px', borderRadius: '10px' }}>
                    <MessageCircle size={18} />
                  </span>
                  <div>
                    <h4 className="font-bold text-sm text-main">WhatsApp</h4>
                    <p className="text-xs text-secondary">Community Format & Markdown</p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={platforms.whatsapp}
                  onChange={() => togglePlatform('whatsapp')}
                  onClick={(e) => e.stopPropagation()}
                  style={{ width: '1.2rem', height: '1.2rem', accentColor: '#25D366', cursor: 'pointer' }}
                />
              </div>
            </div>
          </div>

          {/* AI Model Specs Card */}
          <div className="card flex-col gap-2" style={{ backgroundColor: '#f8fafc' }}>
            <div className="flex items-center gap-2 text-xs font-bold text-main">
              <Info size={15} className="text-primary" /> AI Model Engine
            </div>
            <p className="text-xs text-secondary" style={{ lineHeight: '1.5' }}>
              Powered by <strong className="text-main">Gemini 1.5 Flash</strong>. Formats hashtags, line breaks, emojis, and channel CTAs dynamically.
            </p>
          </div>
        </div>

      </div>
    </div>
  );
}
