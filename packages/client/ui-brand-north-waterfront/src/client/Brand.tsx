import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  SidebarBrandMarkOwnerProps, SidebarBrandNameOwnerProps,
} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import css from './Brand.module.css'

/** Props of the NW badge: the size every brand seat requests plus the hero's layout class. */
export type NorthWaterfrontMarkProps = SidebarBrandMarkOwnerProps & Pick<HeroBrandMarkOwnerProps, 'className'>

/**
 * Render the NW badge: brand initials on an accent tile, identical on both
 * themes, so the seat needs no theme-dependent artwork.
 * @param props.size - requested square edge in pixels.
 * @param props.className - host class preserving the surrounding mark geometry.
 * @returns the badge element (aria-hidden text; pair with the wordmark for accessibility).
 */
export function NorthWaterfrontBrandMark({ size, className }: NorthWaterfrontMarkProps) {
  return (
    <span
      className={className ? `${css.mark} ${className}` : css.mark}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
    >
      NW
    </span>
  )
}

/**
 * Render the north-waterfront wordmark without its independently slotted badge.
 * @returns the wordmark text element.
 */
export function NorthWaterfrontBrandName({}: SidebarBrandNameOwnerProps) {
  return <span className={css.name}>north-<span className={css.accent}>waterfront</span></span>
}

/**
 * Render the NW badge for the blank-session hero at the requested size.
 * @param props.size - requested square edge in pixels.
 * @param props.className - host class preserving the surrounding mark geometry.
 * @returns the badge element.
 */
export function NorthWaterfrontHeroMark({ size, className }: HeroBrandMarkOwnerProps) {
  return <NorthWaterfrontBrandMark size={size} className={className} />
}
