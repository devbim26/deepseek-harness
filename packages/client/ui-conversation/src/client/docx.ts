/** DOCX extraction chunk: statically bundles mammoth's prebuilt browser build
 * (the browserify bundle with node-builtin stubs; the lib entry's node
 * requires cannot load in a browser chunk) so its ~600 KB parse only loads
 * when a `.docx` is picked. The interop helpers the prebuilt needs arrive
 * through the rolldown runtime the client bundle compiler inlines into the
 * package entry.
 * @module @deepseek-ai/dsh-client-ui-conversation/client/docx
 */
import { extractRawText } from 'mammoth/mammoth.browser.js'

/**
 * Extract the plain paragraph text of a picked `.docx` file.
 * @param file - the picked browser file.
 * @returns the concatenated paragraph text mammoth extracted.
 */
export async function extractDocxText(file: File): Promise<string> {
  const { value } = await extractRawText({ arrayBuffer: await file.arrayBuffer() })
  return value
}
