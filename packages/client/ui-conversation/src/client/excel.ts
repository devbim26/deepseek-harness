/** Spreadsheet extraction chunk: statically bundles SheetJS so its ~720 KB
 * parse only loads when an `.xls`/`.xlsx` is picked. The package-local build
 * configuration resolves the `module` (ESM) build: the CommonJS entry probes
 * `require('stream')` under a `typeof require` guard, which a client chunk's
 * module-table `require` satisfies and then rejects.
 * @module @deepseek-ai/dsh-client-ui-conversation/client/excel
 */
import { read, utils } from 'xlsx'

/**
 * Extract every sheet of a picked spreadsheet as CSV text.
 * @param file - the picked `.xls`/`.xlsx` browser file.
 * @returns the sheets' CSV text joined by blank lines.
 */
export async function extractSheetCsv(file: File): Promise<string> {
  const workbook = read(await file.arrayBuffer(), { type: 'array' })
  const sheets: string[] = []
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name]
    if (sheet !== undefined) sheets.push(utils.sheet_to_csv(sheet))
  }
  return sheets.join('\n\n')
}
