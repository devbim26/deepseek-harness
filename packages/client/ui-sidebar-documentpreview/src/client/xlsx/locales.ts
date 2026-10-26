/** Locale-owned XLSX renderer labels and status text. */
export const zh = {
  title: 'Excel',
  loading: '正在打开 Excel…',
  failed: '无法显示这个 Excel 文件。',
  unsupported: 'Excel 预览需要完整文件内容。',
  empty: '工作簿中没有可显示的工作表。',
  rowsTruncated: '仅显示前 {count} 行。',
  sheetLabel: '工作表',
} satisfies Record<string, string>

/** XLSX renderer dictionary keys. */
export type XlsxPreviewKey = keyof typeof zh

/** English dictionary with the same keys as the Chinese dictionary. */
export const en = {
  title: 'Excel',
  loading: 'Opening Excel…',
  failed: 'This Excel file could not be displayed.',
  unsupported: 'Excel preview requires the complete file contents.',
  empty: 'The workbook has no displayable worksheets.',
  rowsTruncated: 'Showing the first {count} rows only.',
  sheetLabel: 'Sheet',
} satisfies Record<XlsxPreviewKey, string>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** XLSX preview selection and status text. */
    sidebarXlsx: XlsxPreviewKey
  }
}
