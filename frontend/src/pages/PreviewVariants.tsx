import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Check, ArrowLeft, Loader2 } from 'lucide-react';
import { fetchApi } from '../lib/apiClient';

export default function PreviewVariants() {
  const navigate = useNavigate();
  const location = useLocation();
  const { automationId, variants } = location.state || {};
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState('');

  if (!automationId || !variants) {
    return (
      <div className="flex-col items-center justify-center py-12">
        <p className="text-secondary">No preview data available.</p>
        <button onClick={() => navigate('/automations/new')} className="btn-primary mt-4">Go Back</button>
      </div>
    );
  }

  const getVariant = (platform: string) => {
    return variants.find((v: any) => v.platform === platform);
  };

  const instagramVariant = getVariant('instagram');
  const twitterVariant = getVariant('twitter');
  const whatsappVariant = getVariant('whatsapp');

  const handlePublish = async () => {
    setPublishing(true);
    setError('');
    try {
      await fetchApi(`/automations/${automationId}/publish`, {
        method: 'POST'
      });
      navigate('/history');
    } catch (err: any) {
      setError(err.message || 'Failed to publish');
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="flex-col gap-6">
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/automations/new')} className="btn-secondary flex items-center gap-2" style={{ padding: '0.5rem' }}>
            <ArrowLeft size={18} />
          </button>
          <div>
            <h2 className="text-2xl font-bold">Review & Publish</h2>
            <p className="text-secondary text-sm">Review your generated variants before publishing.</p>
          </div>
        </div>
        <button onClick={handlePublish} disabled={publishing} className="btn-primary flex items-center gap-2">
          {publishing ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
          {publishing ? 'Publishing...' : 'Publish to All'}
        </button>
      </div>

      {error && (
        <div className="mb-4 text-sm" style={{ padding: '0.75rem', backgroundColor: '#fee2e2', color: '#991b1b', borderRadius: '0.375rem' }}>
          {error}
        </div>
      )}

      <div className="flex gap-4" style={{ overflowX: 'auto', paddingBottom: '1rem' }}>
        {/* Instagram Preview */}
        {instagramVariant && (
          <div className="card" style={{ minWidth: '320px', flex: 1 }}>
            <div className="flex justify-between items-center mb-4" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <span style={{ color: '#E1306C' }}>Instagram</span>
              </h3>
              <span className="text-xs text-secondary">{instagramVariant.char_count} / 2200</span>
            </div>
            <div className="py-4 text-sm" style={{ whiteSpace: 'pre-wrap' }}>
              {instagramVariant.generated_text}
            </div>
            <button className="btn-secondary w-full mt-4">Edit Content</button>
          </div>
        )}

        {/* Twitter Preview */}
        {twitterVariant && (
          <div className="card" style={{ minWidth: '320px', flex: 1 }}>
            <div className="flex justify-between items-center mb-4" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <span style={{ color: '#000' }}>Twitter / X</span>
              </h3>
              <span className="text-xs text-secondary">{twitterVariant.char_count} / 280</span>
            </div>
            <div className="py-4 text-sm" style={{ whiteSpace: 'pre-wrap' }}>
              {twitterVariant.generated_text}
            </div>
            <button className="btn-secondary w-full mt-4">Edit Content</button>
          </div>
        )}

        {/* WhatsApp Preview */}
        {whatsappVariant && (
          <div className="card" style={{ minWidth: '320px', flex: 1 }}>
            <div className="flex justify-between items-center mb-4" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <span style={{ color: '#25D366' }}>WhatsApp</span>
              </h3>
              <span className="text-xs text-secondary">{whatsappVariant.char_count} / 4096</span>
            </div>
            <div className="py-4 text-sm" style={{ whiteSpace: 'pre-wrap' }}>
              {whatsappVariant.generated_text}
            </div>
            <button className="btn-secondary w-full mt-4">Edit Content</button>
          </div>
        )}
      </div>
    </div>
  );
}
