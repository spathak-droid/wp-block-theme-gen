import { z } from 'zod'

export type BlockCategory =
  | 'structure'
  | 'spacing'
  | 'reusability'
  | 'typography'
  | 'quote'
  | 'media'
  | 'cta'
  | 'query'
  | 'post-binding'
  | 'site-binding'
  | 'navigation'

export type BlockDef = {
  name: string
  category: BlockCategory
  isVoid: boolean
  acceptsInnerBlocks: boolean
  acceptsText: boolean
  knownAttrs: z.ZodTypeAny
  /**
   * Build the HTML wrapper that sits between the opening and closing block
   * comments. For void blocks this returns an empty string (wrapper is
   * absent in markup). For text blocks `inner` contains escaped text.
   */
  wrap: (attrs: Record<string, unknown>, inner: string) => string
}

const classList = (...parts: (string | false | null | undefined)[]) =>
  parts.filter((p): p is string => Boolean(p)).join(' ')

const looseAttrs = z.record(z.string(), z.unknown()).optional()

const alignAttr = z.enum(['wide', 'full', 'left', 'center', 'right']).optional()

const attrAlignClasses = (attrs: Record<string, unknown>): string[] => {
  const out: string[] = []
  const align = attrs['align']
  if (align === 'wide') out.push('alignwide')
  if (align === 'full') out.push('alignfull')
  if (align === 'left') out.push('alignleft')
  if (align === 'right') out.push('alignright')
  if (align === 'center') out.push('aligncenter')
  const textAlign = attrs['textAlign']
  if (typeof textAlign === 'string') out.push(`has-text-align-${textAlign}`)
  const fontSize = attrs['fontSize']
  if (typeof fontSize === 'string') out.push(`has-${fontSize}-font-size`, 'has-font-size')
  const backgroundColor = attrs['backgroundColor']
  if (typeof backgroundColor === 'string')
    out.push(`has-${backgroundColor}-background-color`, 'has-background')
  const textColor = attrs['textColor']
  if (typeof textColor === 'string') out.push(`has-${textColor}-color`, 'has-text-color')
  const className = attrs['className']
  if (typeof className === 'string') out.push(className)
  return out
}

const simpleContainer =
  (shortName: string, defaultTag = 'div'): BlockDef['wrap'] =>
  (attrs, inner) => {
    const tag = typeof attrs['tagName'] === 'string' ? (attrs['tagName'] as string) : defaultTag
    const classes = classList(`wp-block-${shortName}`, ...attrAlignClasses(attrs))
    return `<${tag} class="${classes}">${inner}</${tag}>`
  }

export const BLOCKS: Record<string, BlockDef> = {
  // ---------- structure ----------
  'core/group': {
    name: 'core/group',
    category: 'structure',
    isVoid: false,
    acceptsInnerBlocks: true,
    acceptsText: false,
    knownAttrs: z
      .object({
        tagName: z
          .enum(['div', 'header', 'footer', 'main', 'section', 'article', 'aside'])
          .optional(),
        layout: z
          .object({
            type: z.enum(['default', 'constrained', 'flex', 'grid']).optional(),
            orientation: z.enum(['horizontal', 'vertical']).optional(),
            justifyContent: z.enum(['left', 'center', 'right', 'space-between']).optional(),
            flexWrap: z.enum(['wrap', 'nowrap']).optional(),
            minimumColumnWidth: z.string().optional(),
            columnCount: z.number().int().positive().optional(),
          })
          .passthrough()
          .optional(),
        align: alignAttr,
        className: z.string().optional(),
        style: z.record(z.string(), z.unknown()).optional(),
      })
      .passthrough(),
    wrap: simpleContainer('group'),
  },

  'core/columns': {
    name: 'core/columns',
    category: 'structure',
    isVoid: false,
    acceptsInnerBlocks: true,
    acceptsText: false,
    knownAttrs: z
      .object({
        isStackedOnMobile: z.boolean().optional(),
        verticalAlignment: z.enum(['top', 'center', 'bottom']).optional(),
        align: alignAttr,
      })
      .passthrough(),
    wrap: simpleContainer('columns'),
  },

  'core/column': {
    name: 'core/column',
    category: 'structure',
    isVoid: false,
    acceptsInnerBlocks: true,
    acceptsText: false,
    knownAttrs: z
      .object({
        width: z.string().optional(),
        verticalAlignment: z.enum(['top', 'center', 'bottom']).optional(),
      })
      .passthrough(),
    wrap: simpleContainer('column'),
  },

  'core/separator': {
    name: 'core/separator',
    category: 'structure',
    isVoid: true,
    acceptsInnerBlocks: false,
    acceptsText: false,
    knownAttrs: z
      .object({
        opacity: z.enum(['alpha-channel', 'css']).optional(),
        style: z.record(z.string(), z.unknown()).optional(),
      })
      .passthrough(),
    wrap: () => '',
  },

  // ---------- spacing ----------
  'core/spacer': {
    name: 'core/spacer',
    category: 'spacing',
    isVoid: true,
    acceptsInnerBlocks: false,
    acceptsText: false,
    knownAttrs: z
      .object({
        height: z.string().optional(),
        width: z.string().optional(),
      })
      .passthrough(),
    wrap: () => '',
  },

  // ---------- reusability ----------
  'core/template-part': {
    name: 'core/template-part',
    category: 'reusability',
    isVoid: true,
    acceptsInnerBlocks: false,
    acceptsText: false,
    knownAttrs: z
      .object({
        slug: z.string().min(1),
        theme: z.string().optional(),
        area: z.enum(['header', 'footer', 'uncategorized']).optional(),
        tagName: z.string().optional(),
      })
      .passthrough(),
    wrap: () => '',
  },

  'core/pattern': {
    name: 'core/pattern',
    category: 'reusability',
    isVoid: true,
    acceptsInnerBlocks: false,
    acceptsText: false,
    knownAttrs: z
      .object({
        slug: z.string().min(1),
      })
      .passthrough(),
    wrap: () => '',
  },

  // ---------- typography ----------
  'core/heading': {
    name: 'core/heading',
    category: 'typography',
    isVoid: false,
    acceptsInnerBlocks: false,
    acceptsText: true,
    knownAttrs: z
      .object({
        level: z.number().int().min(1).max(6).optional(),
        textAlign: z.enum(['left', 'center', 'right']).optional(),
        fontSize: z.string().optional(),
        content: z.string().optional(),
      })
      .passthrough(),
    wrap: (attrs, inner) => {
      const level =
        typeof attrs['level'] === 'number' && attrs['level'] >= 1 && attrs['level'] <= 6
          ? attrs['level']
          : 2
      const tag = `h${level}`
      const classes = classList('wp-block-heading', ...attrAlignClasses(attrs))
      return `<${tag} class="${classes}">${inner}</${tag}>`
    },
  },

  'core/paragraph': {
    name: 'core/paragraph',
    category: 'typography',
    isVoid: false,
    acceptsInnerBlocks: false,
    acceptsText: true,
    knownAttrs: z
      .object({
        align: z.enum(['left', 'center', 'right']).optional(),
        dropCap: z.boolean().optional(),
        fontSize: z.string().optional(),
      })
      .passthrough(),
    wrap: (attrs, inner) => {
      const classes = classList(...attrAlignClasses({ ...attrs, textAlign: attrs['align'] }))
      return classes ? `<p class="${classes}">${inner}</p>` : `<p>${inner}</p>`
    },
  },

  'core/list': {
    name: 'core/list',
    category: 'typography',
    isVoid: false,
    acceptsInnerBlocks: true,
    acceptsText: false,
    knownAttrs: z
      .object({
        ordered: z.boolean().optional(),
        start: z.number().int().optional(),
        reversed: z.boolean().optional(),
      })
      .passthrough(),
    wrap: (attrs, inner) => {
      const tag = attrs['ordered'] === true ? 'ol' : 'ul'
      return `<${tag} class="wp-block-list">${inner}</${tag}>`
    },
  },

  'core/list-item': {
    name: 'core/list-item',
    category: 'typography',
    isVoid: false,
    acceptsInnerBlocks: false,
    acceptsText: true,
    knownAttrs: looseAttrs,
    wrap: (_attrs, inner) => `<li>${inner}</li>`,
  },

  // ---------- quote ----------
  'core/quote': {
    name: 'core/quote',
    category: 'quote',
    isVoid: false,
    acceptsInnerBlocks: true,
    acceptsText: false,
    knownAttrs: z
      .object({
        citation: z.string().optional(),
        align: alignAttr,
      })
      .passthrough(),
    wrap: simpleContainer('quote', 'blockquote'),
  },

  // ---------- media ----------
  'core/image': {
    name: 'core/image',
    category: 'media',
    isVoid: false,
    acceptsInnerBlocks: false,
    acceptsText: false,
    knownAttrs: z
      .object({
        url: z.string().optional(),
        alt: z.string().optional(),
        id: z.number().int().optional(),
        sizeSlug: z.string().optional(),
        width: z.number().optional(),
        height: z.number().optional(),
        aspectRatio: z.string().optional(),
        caption: z.string().optional(),
        align: alignAttr,
      })
      .passthrough(),
    wrap: (attrs) => {
      const url = typeof attrs['url'] === 'string' ? (attrs['url'] as string) : ''
      const alt = typeof attrs['alt'] === 'string' ? (attrs['alt'] as string) : ''
      const classes = classList('wp-block-image', ...attrAlignClasses(attrs))
      return `<figure class="${classes}"><img src="${url}" alt="${alt}"/></figure>`
    },
  },

  'core/cover': {
    name: 'core/cover',
    category: 'media',
    isVoid: false,
    acceptsInnerBlocks: true,
    acceptsText: false,
    knownAttrs: z
      .object({
        url: z.string().optional(),
        id: z.number().int().optional(),
        dimRatio: z.number().min(0).max(100).optional(),
        overlayColor: z.string().optional(),
        backgroundType: z.enum(['image', 'video']).optional(),
        minHeight: z.number().optional(),
        minHeightUnit: z.string().optional(),
        contentPosition: z.string().optional(),
        isDark: z.boolean().optional(),
        align: alignAttr,
      })
      .passthrough(),
    wrap: (attrs, inner) => {
      const classes = classList('wp-block-cover', ...attrAlignClasses(attrs))
      return `<div class="${classes}"><div class="wp-block-cover__inner-container">${inner}</div></div>`
    },
  },

  // ---------- cta ----------
  'core/buttons': {
    name: 'core/buttons',
    category: 'cta',
    isVoid: false,
    acceptsInnerBlocks: true,
    acceptsText: false,
    knownAttrs: z
      .object({
        layout: z.record(z.string(), z.unknown()).optional(),
        align: alignAttr,
      })
      .passthrough(),
    wrap: simpleContainer('buttons'),
  },

  'core/button': {
    name: 'core/button',
    category: 'cta',
    isVoid: false,
    acceptsInnerBlocks: false,
    acceptsText: true,
    knownAttrs: z
      .object({
        text: z.string().optional(),
        url: z.string().optional(),
        linkTarget: z.string().optional(),
        rel: z.string().optional(),
        style: z.record(z.string(), z.unknown()).optional(),
      })
      .passthrough(),
    wrap: (_attrs, inner) =>
      `<div class="wp-block-button"><a class="wp-block-button__link wp-element-button">${inner}</a></div>`,
  },

  // ---------- query ----------
  'core/query': {
    name: 'core/query',
    category: 'query',
    isVoid: false,
    acceptsInnerBlocks: true,
    acceptsText: false,
    knownAttrs: z
      .object({
        queryId: z.number().int().optional(),
        query: z
          .object({
            perPage: z.number().int().optional(),
            postType: z.string().optional(),
            offset: z.number().int().optional(),
            order: z.enum(['asc', 'desc']).optional(),
            orderBy: z.string().optional(),
            inherit: z.boolean().optional(),
            author: z.string().optional(),
            search: z.string().optional(),
            exclude: z.array(z.number()).optional(),
            sticky: z.enum(['', 'only', 'exclude']).optional(),
          })
          .passthrough()
          .optional(),
        namespace: z.string().optional(),
        enhancedPagination: z.boolean().optional(),
        tagName: z.string().optional(),
        align: alignAttr,
      })
      .passthrough(),
    wrap: simpleContainer('query'),
  },

  'core/post-template': {
    name: 'core/post-template',
    category: 'query',
    isVoid: false,
    acceptsInnerBlocks: true,
    acceptsText: false,
    knownAttrs: z
      .object({
        layout: z.record(z.string(), z.unknown()).optional(),
      })
      .passthrough(),
    wrap: (_attrs, inner) => `<ul class="wp-block-post-template">${inner}</ul>`,
  },

  'core/query-pagination': {
    name: 'core/query-pagination',
    category: 'query',
    isVoid: false,
    acceptsInnerBlocks: true,
    acceptsText: false,
    knownAttrs: z
      .object({
        paginationArrow: z.enum(['none', 'arrow', 'chevron']).optional(),
      })
      .passthrough(),
    wrap: simpleContainer('query-pagination'),
  },

  'core/query-pagination-previous': {
    name: 'core/query-pagination-previous',
    category: 'query',
    isVoid: true,
    acceptsInnerBlocks: false,
    acceptsText: false,
    knownAttrs: looseAttrs,
    wrap: () => '',
  },

  'core/query-pagination-next': {
    name: 'core/query-pagination-next',
    category: 'query',
    isVoid: true,
    acceptsInnerBlocks: false,
    acceptsText: false,
    knownAttrs: looseAttrs,
    wrap: () => '',
  },

  'core/query-pagination-numbers': {
    name: 'core/query-pagination-numbers',
    category: 'query',
    isVoid: true,
    acceptsInnerBlocks: false,
    acceptsText: false,
    knownAttrs: looseAttrs,
    wrap: () => '',
  },

  // ---------- post bindings ----------
  'core/post-title': {
    name: 'core/post-title',
    category: 'post-binding',
    isVoid: true,
    acceptsInnerBlocks: false,
    acceptsText: false,
    knownAttrs: z
      .object({
        isLink: z.boolean().optional(),
        level: z.number().int().min(1).max(6).optional(),
        linkTarget: z.string().optional(),
        rel: z.string().optional(),
        fontSize: z.string().optional(),
        textAlign: z.enum(['left', 'center', 'right']).optional(),
      })
      .passthrough(),
    wrap: () => '',
  },

  'core/post-content': {
    name: 'core/post-content',
    category: 'post-binding',
    isVoid: false,
    acceptsInnerBlocks: true,
    acceptsText: false,
    knownAttrs: z
      .object({
        tagName: z.string().optional(),
        layout: z.record(z.string(), z.unknown()).optional(),
      })
      .passthrough(),
    wrap: simpleContainer('post-content'),
  },

  'core/post-featured-image': {
    name: 'core/post-featured-image',
    category: 'post-binding',
    isVoid: true,
    acceptsInnerBlocks: false,
    acceptsText: false,
    knownAttrs: z
      .object({
        aspectRatio: z.string().optional(),
        isLink: z.boolean().optional(),
        sizeSlug: z.string().optional(),
        width: z.string().optional(),
        height: z.string().optional(),
      })
      .passthrough(),
    wrap: () => '',
  },

  'core/post-date': {
    name: 'core/post-date',
    category: 'post-binding',
    isVoid: true,
    acceptsInnerBlocks: false,
    acceptsText: false,
    knownAttrs: z
      .object({
        format: z.string().optional(),
        isLink: z.boolean().optional(),
        displayType: z.enum(['date', 'modified']).optional(),
      })
      .passthrough(),
    wrap: () => '',
  },

  'core/post-excerpt': {
    name: 'core/post-excerpt',
    category: 'post-binding',
    isVoid: true,
    acceptsInnerBlocks: false,
    acceptsText: false,
    knownAttrs: z
      .object({
        moreText: z.string().optional(),
        showMoreOnNewLine: z.boolean().optional(),
        excerptLength: z.number().int().optional(),
      })
      .passthrough(),
    wrap: () => '',
  },

  'core/post-author': {
    name: 'core/post-author',
    category: 'post-binding',
    isVoid: true,
    acceptsInnerBlocks: false,
    acceptsText: false,
    knownAttrs: z
      .object({
        showAvatar: z.boolean().optional(),
        showBio: z.boolean().optional(),
        byline: z.string().optional(),
      })
      .passthrough(),
    wrap: () => '',
  },

  'core/read-more': {
    name: 'core/read-more',
    category: 'post-binding',
    isVoid: true,
    acceptsInnerBlocks: false,
    acceptsText: false,
    knownAttrs: z
      .object({
        content: z.string().optional(),
        linkTarget: z.string().optional(),
      })
      .passthrough(),
    wrap: () => '',
  },

  // ---------- site bindings ----------
  'core/site-title': {
    name: 'core/site-title',
    category: 'site-binding',
    isVoid: true,
    acceptsInnerBlocks: false,
    acceptsText: false,
    knownAttrs: z
      .object({
        level: z.number().int().min(0).max(6).optional(),
        isLink: z.boolean().optional(),
        linkTarget: z.string().optional(),
        fontSize: z.string().optional(),
      })
      .passthrough(),
    wrap: () => '',
  },

  'core/site-logo': {
    name: 'core/site-logo',
    category: 'site-binding',
    isVoid: true,
    acceptsInnerBlocks: false,
    acceptsText: false,
    knownAttrs: z
      .object({
        width: z.number().int().optional(),
        isLink: z.boolean().optional(),
        shouldSyncIcon: z.boolean().optional(),
      })
      .passthrough(),
    wrap: () => '',
  },

  'core/site-tagline': {
    name: 'core/site-tagline',
    category: 'site-binding',
    isVoid: true,
    acceptsInnerBlocks: false,
    acceptsText: false,
    knownAttrs: z
      .object({
        textAlign: z.enum(['left', 'center', 'right']).optional(),
        fontSize: z.string().optional(),
      })
      .passthrough(),
    wrap: () => '',
  },

  // ---------- navigation ----------
  'core/navigation': {
    name: 'core/navigation',
    category: 'navigation',
    isVoid: false,
    acceptsInnerBlocks: true,
    acceptsText: false,
    knownAttrs: z
      .object({
        ref: z.number().int().optional(),
        overlayMenu: z.enum(['never', 'always', 'mobile']).optional(),
        maxNestingLevel: z.number().int().optional(),
        layout: z.record(z.string(), z.unknown()).optional(),
      })
      .passthrough(),
    wrap: (_attrs, inner) => `<nav class="wp-block-navigation">${inner}</nav>`,
  },

  'core/navigation-link': {
    name: 'core/navigation-link',
    category: 'navigation',
    isVoid: true,
    acceptsInnerBlocks: false,
    acceptsText: false,
    knownAttrs: z
      .object({
        label: z.string().optional(),
        url: z.string().optional(),
        kind: z.string().optional(),
        type: z.string().optional(),
        id: z.number().int().optional(),
      })
      .passthrough(),
    wrap: () => '',
  },

  'core/navigation-submenu': {
    name: 'core/navigation-submenu',
    category: 'navigation',
    isVoid: false,
    acceptsInnerBlocks: true,
    acceptsText: false,
    knownAttrs: z
      .object({
        label: z.string().optional(),
        url: z.string().optional(),
      })
      .passthrough(),
    wrap: (_attrs, inner) => `<div class="wp-block-navigation-submenu">${inner}</div>`,
  },
}

export const CORE_BLOCK_NAMES = Object.keys(BLOCKS) as readonly string[]

// Sanity: we maintain exactly 35 core blocks. `core/html` is NEVER in this list.
export const EXPECTED_BLOCK_COUNT = 35

if (CORE_BLOCK_NAMES.length !== EXPECTED_BLOCK_COUNT) {
  throw new Error(
    `Block taxonomy mismatch: expected ${EXPECTED_BLOCK_COUNT} blocks, got ${CORE_BLOCK_NAMES.length}`,
  )
}

if (CORE_BLOCK_NAMES.includes('core/html')) {
  throw new Error('core/html must never appear in taxonomy — this is the project`s defining rule')
}

export function getBlockDef(name: string): BlockDef | undefined {
  return BLOCKS[name]
}

export function isKnownBlock(name: string): boolean {
  return name in BLOCKS
}

/**
 * Convert a full block name like `core/group` to its short form `group`
 * (used in block markup comments — WordPress omits the `core/` prefix).
 */
export function shortName(fullName: string): string {
  return fullName.startsWith('core/') ? fullName.slice(5) : fullName
}

/**
 * Convert short form back to full name.
 */
export function fullName(short: string): string {
  return short.includes('/') ? short : `core/${short}`
}
