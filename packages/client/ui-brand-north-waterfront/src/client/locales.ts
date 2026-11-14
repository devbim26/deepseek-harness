/** `ui-brand-north-waterfront` namespace dictionaries: the brand identifiers every brand seat renders. */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'

/** Simplified Chinese dictionary and key-set source of truth. Brand identifiers carry no translation. */
export const zh = {
  'mark.initials': 'NW',
  'name.lead': 'north-',
  'name.accent': 'waterfront',
} satisfies Record<string, string>

/** Brand-dictionary key union. */
export type NorthWaterfrontBrandKey = keyof typeof zh

/**
 * Copy seat the slot framework injects into each brand occupant. Owning it
 * here keeps the namespace merge in every program that types an occupant.
 */
export type BrandLocale = PropsLocale<'ui-brand-north-waterfront'>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** north-waterfront brand identifiers. */
    'ui-brand-north-waterfront': NorthWaterfrontBrandKey
  }
}

/** English dictionary, checked against the Chinese key set. */
export const en = {
  'mark.initials': 'NW',
  'name.lead': 'north-',
  'name.accent': 'waterfront',
} satisfies Record<NorthWaterfrontBrandKey, string>

/** Japanese copy, checked against the English keys. */
export const ja = {
  'mark.initials': 'NW',
  'name.lead': 'north-',
  'name.accent': 'waterfront',
} satisfies Record<NorthWaterfrontBrandKey, string>

/** Spanish copy, checked against the English keys. */
export const es = {
  'mark.initials': 'NW',
  'name.lead': 'north-',
  'name.accent': 'waterfront',
} satisfies Record<NorthWaterfrontBrandKey, string>

/** French copy, checked against the English keys. */
export const fr = {
  'mark.initials': 'NW',
  'name.lead': 'north-',
  'name.accent': 'waterfront',
} satisfies Record<NorthWaterfrontBrandKey, string>

/** German copy, checked against the English keys. */
export const de = {
  'mark.initials': 'NW',
  'name.lead': 'north-',
  'name.accent': 'waterfront',
} satisfies Record<NorthWaterfrontBrandKey, string>

/** Russian copy, checked against the English keys. */
export const ru = {
  'mark.initials': 'NW',
  'name.lead': 'north-',
  'name.accent': 'waterfront',
} satisfies Record<NorthWaterfrontBrandKey, string>

/** Portuguese copy, checked against the English keys. */
export const pt = {
  'mark.initials': 'NW',
  'name.lead': 'north-',
  'name.accent': 'waterfront',
} satisfies Record<NorthWaterfrontBrandKey, string>
