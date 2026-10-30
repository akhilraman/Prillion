import { useState } from 'react';
import { isMuted, play, setMuted } from '../game/sound.ts';

interface MuteToggleProps {
  className?: string;
}

export function MuteToggle({ className = '' }: MuteToggleProps) {
  const [muted, setMutedState] = useState(isMuted);

  function toggle() {
    const next = !muted;
    setMuted(next);
    setMutedState(next);
    if (!next) play('descend');
  }

  return (
    <button
      type="button"
      className={`mute${className ? ` ${className}` : ''}`}
      aria-pressed={muted}
      aria-label={muted ? 'Unmute sounds' : 'Mute sounds'}
      onClick={toggle}
    >
      {muted ? 'SFX off' : 'SFX on'}
    </button>
  );
}
