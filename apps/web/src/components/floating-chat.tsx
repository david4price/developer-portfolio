'use client';

import { useState } from 'react';
import { PortfolioAssistant } from '@/mini-apps/portfolio-assistant/loader';
import { assistantName } from '@/lib/assistant';
import { ChatOverlay } from './chat-overlay';

/** The layout retains one conversation across page navigation and closing/reopening the popup. */
export function FloatingChat() {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [waiting, setWaiting] = useState(false);

  return (
    <ChatOverlay
      assistantName={assistantName}
      open={open}
      waiting={waiting}
      loaded={loaded}
      onOpen={() => {
        setLoaded(true);
        setOpen(true);
      }}
      onClose={() => setOpen(false)}
    >
      {loaded && (
        <PortfolioAssistant
          active={open}
          onNavigate={() => setOpen(false)}
          onWaitingChange={setWaiting}
        />
      )}
    </ChatOverlay>
  );
}
