/**
 * Barrel export for the ATP in-app icon system.
 *
 * 27 icons total. 8 of them animate when `active` is true:
 *   - Streak  (flame flicker)
 *   - Live    (concentric broadcast pulse)
 *   - Eye     (blink every 3s)
 *   - Heart   (lub-dub at 70 BPM)
 *   - Notification (bell shake)
 *   - Target  (outer ring rotation)
 *   - Bolt    (electric flash)
 *   - Chat    (typing-dot bounce)
 *
 * Usage:
 *   import { IconLocation, IconStreak } from '@/lib/components/icons';
 *   <IconLocation size={20} color={colors.muted} />
 *   <IconStreak size={20} color={colors.green} active={isAlive} />
 *
 * For dynamic dispatch (when the icon name comes from data):
 *   import { Icon } from '@/lib/components/icons';
 *   <Icon name="trophy" size={24} color={colors.white} />
 */

export { IconLocation }       from './IconLocation';
export { IconCheck }          from './IconCheck';
export { IconChat }           from './IconChat';
export { IconStreak }         from './IconStreak';
export { IconTrophy }         from './IconTrophy';
export { IconLock }           from './IconLock';
export { IconCamera }         from './IconCamera';
export { IconLive }           from './IconLive';
export { IconStory }          from './IconStory';
export { IconProfile }        from './IconProfile';
export { IconEye }            from './IconEye';
export { IconTarget }         from './IconTarget';
export { IconGift }           from './IconGift';
export { IconBolt }           from './IconBolt';
export { IconDumbbell }       from './IconDumbbell';
export { IconWallet }         from './IconWallet';
export { IconInbox }          from './IconInbox';
export { IconClipboard }      from './IconClipboard';
export { IconTicket }         from './IconTicket';
export { IconHeart }          from './IconHeart';
export { IconBag }            from './IconBag';
export { IconHelp }           from './IconHelp';
export { IconNoEntry }        from './IconNoEntry';
export { IconNotification }   from './IconNotification';
export { IconEdit }           from './IconEdit';
export { IconInfo }           from './IconInfo';
export { IconShield }         from './IconShield';
export { IconHome }           from './IconHome';
export { IconCalendar }       from './IconCalendar';
export { IconCommunity }      from './IconCommunity';
// Tab-bar-specific marks (matching contact sheet NAVIGATION row)
export { IconTabHome }        from './IconTabHome';
export { IconTabSessions }    from './IconTabSessions';
export { IconTabCommunity }   from './IconTabCommunity';
export { IconTabRewards }     from './IconTabRewards';
export { IconTabProfile }     from './IconTabProfile';

export type { IconProps } from './types';

// Dynamic dispatcher — `<Icon name="trophy" />`
import { IconLocation as _L }      from './IconLocation';
import { IconCheck as _C }         from './IconCheck';
import { IconChat as _Ch }         from './IconChat';
import { IconStreak as _S }        from './IconStreak';
import { IconTrophy as _T }        from './IconTrophy';
import { IconLock as _Lk }         from './IconLock';
import { IconCamera as _Cam }      from './IconCamera';
import { IconLive as _Lv }         from './IconLive';
import { IconStory as _St }        from './IconStory';
import { IconProfile as _P }       from './IconProfile';
import { IconEye as _E }           from './IconEye';
import { IconTarget as _Tg }       from './IconTarget';
import { IconGift as _G }          from './IconGift';
import { IconBolt as _Bt }         from './IconBolt';
import { IconDumbbell as _D }      from './IconDumbbell';
import { IconWallet as _W }        from './IconWallet';
import { IconInbox as _In }        from './IconInbox';
import { IconClipboard as _Cl }    from './IconClipboard';
import { IconTicket as _Tk }       from './IconTicket';
import { IconHeart as _H }         from './IconHeart';
import { IconBag as _Bg }          from './IconBag';
import { IconHelp as _Hp }         from './IconHelp';
import { IconNoEntry as _N }       from './IconNoEntry';
import { IconNotification as _Nt } from './IconNotification';
import { IconEdit as _Ed }         from './IconEdit';
import { IconInfo as _If }         from './IconInfo';
import { IconShield as _Sh }       from './IconShield';
import type { IconProps } from './types';

export type IconName =
  | 'location' | 'check' | 'chat' | 'streak' | 'trophy' | 'lock' | 'camera'
  | 'live' | 'story' | 'profile' | 'eye' | 'target' | 'gift' | 'bolt'
  | 'dumbbell' | 'wallet' | 'inbox' | 'clipboard' | 'ticket' | 'heart'
  | 'bag' | 'help' | 'no-entry' | 'notification' | 'edit' | 'info' | 'shield';

const MAP: Record<IconName, React.FC<IconProps>> = {
  'location':     _L,
  'check':        _C,
  'chat':         _Ch,
  'streak':       _S,
  'trophy':       _T,
  'lock':         _Lk,
  'camera':       _Cam,
  'live':         _Lv,
  'story':        _St,
  'profile':      _P,
  'eye':          _E,
  'target':       _Tg,
  'gift':         _G,
  'bolt':         _Bt,
  'dumbbell':     _D,
  'wallet':       _W,
  'inbox':        _In,
  'clipboard':    _Cl,
  'ticket':       _Tk,
  'heart':        _H,
  'bag':          _Bg,
  'help':         _Hp,
  'no-entry':     _N,
  'notification': _Nt,
  'edit':         _Ed,
  'info':         _If,
  'shield':       _Sh,
};

export function Icon({ name, ...rest }: IconProps & { name: IconName }) {
  const Cmp = MAP[name];
  if (!Cmp) return null;
  return <Cmp {...rest} />;
}
