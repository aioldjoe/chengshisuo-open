declare module "opencc-js" {
  /** 簡繁字級轉換器（成事所只用 cn→tw）。 */
  export function Converter(opts: { from: string; to: string }): (s: string) => string;
}
