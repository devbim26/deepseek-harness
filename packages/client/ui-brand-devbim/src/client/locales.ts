/** `ui-brand-devbim` namespace dictionaries: the brand identifiers every brand seat renders. */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'

/** Simplified Chinese dictionary and key-set source of truth. Brand identifiers carry no translation. */
export const zh = {
  'name.lead': 'dev',
  'name.accent': 'BIM',
} satisfies Record<string, string>

/** Brand-dictionary key union. */
export type DevBimBrandKey = keyof typeof zh

/**
 * Copy seat the slot framework injects into each brand occupant. Owning it
 * here keeps the namespace merge in every program that types an occupant.
 */
export type BrandLocale = PropsLocale<'ui-brand-devbim'>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** devBIM brand identifiers. */
    'ui-brand-devbim': DevBimBrandKey
  }
}

/** English dictionary, checked against the Chinese key set. */
export const en = {
  'name.lead': 'dev',
  'name.accent': 'BIM',
} satisfies Record<DevBimBrandKey, string>

/** Japanese copy, checked against the English keys. */
export const ja = {
  'name.lead': 'dev',
  'name.accent': 'BIM',
} satisfies Record<DevBimBrandKey, string>

/** Spanish copy, checked against the English keys. */
export const es = {
  'name.lead': 'dev',
  'name.accent': 'BIM',
} satisfies Record<DevBimBrandKey, string>

/** French copy, checked against the English keys. */
export const fr = {
  'name.lead': 'dev',
  'name.accent': 'BIM',
} satisfies Record<DevBimBrandKey, string>

/** German copy, checked against the English keys. */
export const de = {
  'name.lead': 'dev',
  'name.accent': 'BIM',
} satisfies Record<DevBimBrandKey, string>

/** Russian copy, checked against the English keys. */
export const ru = {
  'name.lead': 'dev',
  'name.accent': 'BIM',
} satisfies Record<DevBimBrandKey, string>

/** Portuguese copy, checked against the English keys. */
export const pt = {
  'name.lead': 'dev',
  'name.accent': 'BIM',
} satisfies Record<DevBimBrandKey, string>
