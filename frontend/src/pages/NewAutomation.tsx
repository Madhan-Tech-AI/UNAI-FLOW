import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, AtSign, MessageCircle, Send, Loader2 } from 'lucide-react';
import { fetchApi } from '../lib/apiClient';

export default function NewAutomation() {
  const navigate = useNavigate();
  const [content, setContent] = useState('');
  const [campaignName, setCampaignName] = useState('');
  const [tone, setTone] = useState('professional');
  const [ctaLink, setCtaLink] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  const [platforms, setPlatforms] = useState({
    instagram: true,
    twitter: true,
    whatsapp: true
  });

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
      // 1. Create the automation
      const automation = await fetchApi('/automations', {
        method: 'POST',
        body: JSON.stringify({
          campaign_name: campaignName || null,
          raw_content: content,
          tone,
          cta_link: ctaLink || null,
          target_platforms: targetPlatforms,
          schedule_type: 'now'
        })
      });

      // 2. Generate variants
      const response = await fetchApi(`/automations/${automation.id}/generate`, {
        method: 'POST'
      });

      // 3. Navigate to preview
      navigate('/automations/preview', { 
        state: { 
          automationId: automation.id, 
          variants: response.variants 
        } 
      });
    } catch (err: any) {
      setError(err.message || 'Failed to generate variants');
    } finally {
      setLoading(false);
    }
  };

  const togglePlatform = (key: keyof typeof platforms) => {
    setPlatforms(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="flex-col gap-6">
      <div className="mb-4">
        <h2 className="text-2xl font-bold">New Automation</h2>
        <p className="text-secondary mt-1">Write once, generate native content for all platforms.</p>
      </div>

      {error && (
        <div className="mb-4 text-sm" style={{ padding: '0.75rem', backgroundColor: '#fee2e2', color: '#991b1b', borderRadius: '0.375rem' }}>
          {error}
        </div>
      )}

      <div className="flex gap-6">
        <div className="card w-full flex-col gap-6" style={{ flex: 2 }}>
          <form onSubmit={handleGenerate} className="flex-col gap-4">
            <div>
              <label className="label" htmlFor="campaignName">Campaign Name (Optional)</label>
              <input
                id="campaignName"
                className="input"
                placeholder="e.g. Q3 Product Launch"
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
              />
            </div>

            <div>
              <label className="label" htmlFor="content">Raw Content</label>
              <textarea
                id="content"
                className="input"
                rows={6}
                placeholder="Write your core message here..."
                value={content}
                onChange={(e) => setContent(e.target.value)}
                required
                style={{ resize: 'vertical' }}
              />
            </div>

            <div className="flex gap-4">
              <div className="w-full">
                <label className="label" htmlFor="tone">Brand Tone</label>
                <select 
                  id="tone" 
                  className="input" 
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                >
                  <option value="professional">Professional</option>
                  <option value="casual">Casual</option>
                  <option value="promotional">Promotional</option>
                </select>
              </div>
              <div className="w-full">
                <label className="label" htmlFor="media">Media (Optional)</label>
                <input type="file" id="media" className="input" accept="image/*,video/*" />
              </div>
            </div>

            <div>
              <label className="label" htmlFor="ctaLink">CTA Link (Optional)</label>
              <input
                id="ctaLink"
                type="url"
                className="input"
                placeholder="https://example.com"
                value={ctaLink}
                onChange={(e) => setCtaLink(e.target.value)}
              />
            </div>
            
            <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--border)' }}>
              <button type="submit" className="btn-primary w-full flex items-center justify-center gap-2" style={{ padding: '0.75rem' }} disabled={loading}>
                {loading ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                {loading ? 'Generating Previews...' : 'Generate Previews'}
              </button>
            </div>
          </form>
        </div>

        <div className="flex-col gap-4" style={{ flex: 1 }}>
          <div className="card">
            <h3 className="font-semibold mb-4">Target Platforms</h3>
            <div className="flex-col gap-3">
              <label className="flex items-center justify-between cursor-pointer" style={{ padding: '0.5rem', borderRadius: '0.375rem', backgroundColor: platforms.instagram ? 'var(--bg-secondary)' : 'transparent' }}>
                <div className="flex items-center gap-3">
                  <Camera size={20} color="#E1306C" />
                  <span className="font-medium">Instagram</span>
                </div>
                <input type="checkbox" checked={platforms.instagram} onChange={() => togglePlatform('instagram')} style={{ width: '1.25rem', height: '1.25rem' }} />
              </label>
              
              <label className="flex items-center justify-between cursor-pointer" style={{ padding: '0.5rem', borderRadius: '0.375rem', backgroundColor: platforms.twitter ? 'var(--bg-secondary)' : 'transparent' }}>
                <div className="flex items-center gap-3">
                  <AtSign size={20} color="#000" />
                  <span className="font-medium">Twitter / X</span>
                </div>
                <input type="checkbox" checked={platforms.twitter} onChange={() => togglePlatform('twitter')} style={{ width: '1.25rem', height: '1.25rem' }} />
              </label>
              
              <label className="flex items-center justify-between cursor-pointer" style={{ padding: '0.5rem', borderRadius: '0.375rem', backgroundColor: platforms.whatsapp ? 'var(--bg-secondary)' : 'transparent' }}>
                <div className="flex items-center gap-3">
                  <MessageCircle size={20} color="#25D366" />
                  <span className="font-medium">WhatsApp</span>
                </div>
                <input type="checkbox" checked={platforms.whatsapp} onChange={() => togglePlatform('whatsapp')} style={{ width: '1.25rem', height: '1.25rem' }} />
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
