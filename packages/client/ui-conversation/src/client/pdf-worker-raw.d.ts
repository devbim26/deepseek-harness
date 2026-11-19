/** Build-owned pdf.js Worker source embedded by this package's tsdown
 * configuration through its `dsh-ui-conversation-pdf-worker-source` plugin. */
declare module 'pdfjs-dist/build/pdf.worker.min.mjs?raw' {
  /** The complete Worker script text. */
  const source: string
  export default source
}
