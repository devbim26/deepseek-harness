import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  SidebarBrandMarkOwnerProps, SidebarBrandNameOwnerProps,
} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import css from './Brand.module.css'
import type { BrandLocale } from './locales.ts'

/** Props of the NW badge: the size every brand seat requests plus the hero's layout class. */
export type NorthWaterfrontMarkProps = SidebarBrandMarkOwnerProps & Pick<HeroBrandMarkOwnerProps, 'className'> & BrandLocale

/** Props of the sidebar wordmark occupant. */
export type NorthWaterfrontNameProps = SidebarBrandNameOwnerProps & BrandLocale

/**
 * Render the NW badge: brand initials on an accent tile, identical on both
 * themes, so the seat needs no theme-dependent artwork.
 * @param props.size - requested square edge in pixels.
 * @param props.className - host class preserving the surrounding mark geometry.
 * @param props.t - brand-copy seat.
 * @returns the badge element (aria-hidden text; pair with the wordmark for accessibility).
 */
export function NorthWaterfrontBrandMark({ size, className, t }: NorthWaterfrontMarkProps) {
  return (
    <span
      className={className ? `${css.mark} ${className}` : css.mark}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
    >
      {t('mark.initials')}
    </span>
  )
}

/**
 * Render the north-waterfront wordmark without its independently slotted badge.
 * @param props.t - brand-copy seat.
 * @returns the wordmark text element.
 */
export function NorthWaterfrontBrandName({ t }: NorthWaterfrontNameProps) {
  return <span className={css.name}>{t('name.lead')}<span className={css.accent}>{t('name.accent')}</span></span>
}

/**
 * Render the NW badge for the blank-session hero at the requested size.
 * @param props.size - requested square edge in pixels.
 * @param props.className - host class preserving the surrounding mark geometry.
 * @param props.t - brand-copy seat.
 * @returns the badge element.
 */
export function NorthWaterfrontHeroMark({ size, className, t }: HeroBrandMarkOwnerProps & BrandLocale) {
  return <NorthWaterfrontBrandMark size={size} className={className} t={t} />
}
