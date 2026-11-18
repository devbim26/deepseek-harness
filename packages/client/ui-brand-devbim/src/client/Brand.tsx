import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  SidebarBrandMarkOwnerProps, SidebarBrandNameOwnerProps,
} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { DEVBIM_MARK_DARK, DEVBIM_MARK_LIGHT, DEVBIM_MARK_VIEWBOX } from './artwork.ts'
import css from './Brand.module.css'
import type { BrandLocale } from './locales.ts'

/** Props of the monogram: the size every brand seat requests plus the hero's layout class. */
export type DevBimMarkProps = SidebarBrandMarkOwnerProps & Pick<HeroBrandMarkOwnerProps, 'className'>

/** Props of the sidebar wordmark occupant. */
export type DevBimNameProps = SidebarBrandNameOwnerProps & BrandLocale

/**
 * Render the dB monogram in the theme-appropriate variant.
 * @param props.size - requested square edge in pixels (height keeps the 210:122 ratio).
 * @param props.className - host class preserving the surrounding mark geometry.
 * @returns the monogram image pair (aria-hidden; pair with the wordmark for accessibility).
 */
export function DevBimBrandMark({ size, className }: DevBimMarkProps) {
  const height = (size * DEVBIM_MARK_VIEWBOX.height) / DEVBIM_MARK_VIEWBOX.width
  return (
    <span className={className ? `${css.mark} ${className}` : css.mark} style={{ width: size, height }}>
      <img className={css.light} src={DEVBIM_MARK_LIGHT} width={size} height={height} alt="" draggable={false} />
      <img className={css.dark} src={DEVBIM_MARK_DARK} width={size} height={height} alt="" draggable={false} />
    </span>
  )
}

/**
 * Render the devBIM wordmark without its independently slotted mark.
 * @param props.t - brand-copy seat.
 * @returns the wordmark text element.
 */
export function DevBimBrandName({ t }: DevBimNameProps) {
  return <span className={css.name}>{t('name.lead')}<span className={css.accent}>{t('name.accent')}</span></span>
}

/**
 * Render the dB monogram for the blank-session hero at the requested size.
 * @param props.size - requested square edge in pixels.
 * @param props.className - host class preserving the surrounding mark geometry.
 * @returns the monogram image pair.
 */
export function DevBimHeroMark({ size, className }: HeroBrandMarkOwnerProps) {
  return <DevBimBrandMark size={size} className={className} />
}
