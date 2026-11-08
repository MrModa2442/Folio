import React from 'react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { WifiOff } from 'lucide-react';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="fixed bottom-24 left-4 z-50 flex items-center gap-2 rounded-full bg-[#1DB954] px-3.5 py-1.5 text-xs font-semibold text-black shadow-lg">
      <WifiOff className="w-3.5 h-3.5" />
      <span>Offline Mode Active — Local PDFs &amp; Ambient Audio Ready</span>
    </div>
  );
};
