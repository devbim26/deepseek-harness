/** PDF extraction chunk: statically bundles pdf.js's legacy build (its node
 * probes are guarded, and its module init tolerates DOM-less environments
 * such as jsdom) plus its same-version module Worker source, so the ~730 KB
 * parse only loads when a PDF is picked.
 * @module @deepseek-ai/dsh-client-ui-conversation/client/pdf
 */
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerSource from 'pdfjs-dist/build/pdf.worker.min.mjs?raw'

let workerUrl: string | undefined

/** Point pdf.js at its same-version module Worker built from the embedded
 * source; the page's first PDF creates the blob URL once. Environments
 * without a Worker constructor (jsdom, Node) keep pdf.js's own fake-worker
 * path, which cannot load a blob URL. */
function ensureWorker(): void {
  if (typeof Worker !== 'function') return
  if (workerUrl === undefined) {
    workerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }))
  }
  GlobalWorkerOptions.workerSrc = workerUrl
}

/**
 * Extract the text layer of a picked PDF, page by page.
 * @param file - the picked browser file.
 * @param signal - aborts between pages.
 * @returns the concatenated page text, empty when the document carries none.
 */
export async function extractPdfText(file: File, signal: AbortSignal | undefined): Promise<string> {
  ensureWorker()
  const document = await getDocument({ data: await file.arrayBuffer() }).promise
  const pages: string[] = []
  try {
    for (let number = 1; number <= document.numPages; number++) {
      if (signal?.aborted === true) throw new Error('document-extract: aborted')
      const page = await document.getPage(number)
      const content = await page.getTextContent()
      pages.push(content.items.map(item => 'str' in item ? item.str : '').join(' '))
      page.cleanup()
    }
  } finally {
    void document.destroy()
  }
  return pages.join('\n\n').trim()
}
