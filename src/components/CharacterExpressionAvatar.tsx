import React, { useEffect, useState } from 'react';
import type { CharacterId, FacialExpression } from '../game/types';
import { CHARACTER_MAP } from '../game/constants';

interface CharacterExpressionAvatarProps {
  characterId: CharacterId;
  expression?: FacialExpression;
  sizeClass?: string;
  glitch?: boolean;
}

export const CharacterExpressionAvatar: React.FC<CharacterExpressionAvatarProps> = ({
  characterId,
  expression: _expression = 'normal',
  sizeClass = 'w-11 h-11',
  glitch = false,
}) => {
  const spec = CHARACTER_MAP[characterId];
  const isExe = characterId === 'jarvin_exe' || characterId === 'crash_exe';
  const isOxide = characterId === 'nitros_oxide';
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
  }, [spec?.avatarUrl]);

  const showImage = Boolean(spec?.avatarUrl) && !imgFailed;

  return (
    <div
      className={`relative rounded-full shrink-0 overflow-hidden border-2 bg-slate-900 select-none ${sizeClass} ${
        glitch || isExe ? 'glitch-fx' : ''
      }`}
      style={{ borderColor: spec?.accentColor ?? '#22c55e' }}
    >
      {showImage ? (
        <img
          src={spec.avatarUrl}
          alt={spec.name}
          referrerPolicy="no-referrer"
          onError={() => setImgFailed(true)}
          className={`w-full h-full object-cover ${
            isExe ? 'hue-rotate-[-38deg] contrast-125 saturate-150' : ''
          }`}
        />
      ) : (
        <div
          className="w-full h-full flex items-center justify-center font-display font-bold text-xs text-white"
          style={{ backgroundColor: isOxide ? '#15803d' : spec?.accentColor ?? '#16a34a' }}
        >
          {isOxide ? 'NOX' : spec?.name?.[0] ?? '?'}
        </div>
      )}
    </div>
  );
};
