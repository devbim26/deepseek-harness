/** Builtin XLSX metadata and keyed document-body registration. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '../index.ts'
import type { DocumentPreviewDefinition } from '../document/registry.ts'
import { XlsxBody } from './XlsxBody.tsx'
import { en, zh } from './locales.ts'

/** XLSX implementation identity, shared by metadata and the keyed slot. */
export const XLSX_BODY_ID = '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/xlsx'

/** File suffixes rendered by the builtin XLSX body; `.xlsx` stays with the excel body. */
export const XLSX_EXTENSIONS = ['xlsm'] as const

/**
 * Describe the builtin XLSX renderer independently from its keyed body slot.
 * @param title - locale-owned implementation name.
 * @returns metadata for complete Excel workbooks.
 */
export function xlsxBodyDefinition(title: () => string): DocumentPreviewDefinition {
  return {
    id: XLSX_BODY_ID,
    extensions: XLSX_EXTENSIONS,
    priority: 'builtin',
    title,
    loading: 'bytes-complete',
    wrap: false,
  }
}

/**
 * Register the XLSX dictionary, metadata, and body with reversible effects.
 * @param ctx - owning plugin context.
 */
export function apply(ctx: Context): void {
  const t = ctx.locale.bind('sidebarXlsx')
  ctx.effect(() => ctx.locale.register('sidebarXlsx', { zh, en }), 'document-xlsx: dictionaries')
  ctx.effect(() => ctx.documentPreviews.register(xlsxBodyDefinition(() => t('title'))), 'document-xlsx: metadata')
  ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register(
    { name: 'sidebar.right.tab.document', key: XLSX_BODY_ID, locale: 'sidebarXlsx' }, XlsxBody,
  )), 'document-xlsx: body')
}
