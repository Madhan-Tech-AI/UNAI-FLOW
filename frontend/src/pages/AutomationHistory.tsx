import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { Loader2 } from 'lucide-react';

export default function AutomationHistory() {
  const [automations, setAutomations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchAutomations() {
      const { data, error } = await supabase
        .from('automations')
        .select('*')
        .order('created_at', { ascending: false });

      if (!error && data) {
        setAutomations(data);
      }
      setLoading(false);
    }
    
    fetchAutomations();
  }, []);

  return (
    <div className="flex-col gap-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold">Automation History</h2>
      </div>

      <div className="card">
        {loading ? (
          <div className="flex justify-center py-12 text-secondary">
            <Loader2 size={24} className="animate-spin" />
          </div>
        ) : automations.length === 0 ? (
          <div className="text-center py-12 text-secondary">
            <p>No history available yet.</p>
          </div>
        ) : (
          <div className="flex-col gap-4">
            {automations.map(auto => (
              <div key={auto.id} className="flex justify-between items-center" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '1rem', marginBottom: '1rem' }}>
                <div>
                  <h3 className="font-semibold text-lg">{auto.campaign_name || 'Untitled Automation'}</h3>
                  <p className="text-sm text-secondary truncate" style={{ maxWidth: '400px' }}>{auto.raw_content}</p>
                </div>
                <div className="flex gap-2">
                  {auto.target_platforms.map((p: string) => (
                    <span key={p} className="chip chip-default capitalize">{p}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
