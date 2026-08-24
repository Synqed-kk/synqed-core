// Shared privacy utilities (msg-7 item 7) — ONE implementation both apps use.
//
// (a) Sensitive-name comparison must treat spacings and character widths as
//     the same name: 青木陽菜 ≡ 青木 陽菜 ≡ ｱｵｷ...half/full-width variants.
//     Compare nameKey(a) === nameKey(b), never raw strings.
// (b) An empty result caused by "no permission" must be distinguishable from
//     a true zero — DeniedAware<T> is the shared shape: denied=true means
//     "you may not see this", items=[] with denied=false means "truly none".

/** Canonical comparison key: NFKC-fold widths (full-width ASCII → half,
 *  half-width kana → full), strip ALL whitespace (incl. ideographic U+3000),
 *  lowercase. */
export function nameKey(name: string): string {
  return name.normalize('NFKC').replace(/[\s　]+/g, '').toLowerCase()
}

/** True when two names denote the same person-name under the house rule. */
export function sameName(a: string, b: string): boolean {
  return nameKey(a) === nameKey(b)
}

/** The permission-vs-zero shape (item 7b). Screens must render denied=true as
 *  "not allowed to view", never as 0. */
export interface DeniedAware<T> {
  items: T[]
  denied: boolean
}

export function deniedResult<T>(): DeniedAware<T> {
  return { items: [], denied: true }
}

export function allowedResult<T>(items: T[]): DeniedAware<T> {
  return { items, denied: false }
}
