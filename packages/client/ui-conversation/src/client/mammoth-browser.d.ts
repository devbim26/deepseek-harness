/** Types for mammoth's prebuilt browser bundle, which ships without
 * declarations; `docx.ts` loads it because the typed Node entry does not
 * implement the `arrayBuffer` input. */
declare module 'mammoth/mammoth.browser.js' {
  /** Extract the plain paragraph text of a .docx archive.
   * @param input - the archive bytes.
   * @returns the extracted text with mammoth's conversion messages.
   */
  export function extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<{ value: string }>
}
